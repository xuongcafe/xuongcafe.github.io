(function () {
  "use strict";

  const DB_NAME = "pgh-offline-v2";
  const DB_VERSION = 2;
  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        let tickets;
        if (!db.objectStoreNames.contains("tickets")) tickets = db.createObjectStore("tickets", { keyPath: "key" });
        else tickets = request.transaction.objectStore("tickets");
        if (!tickets.indexNames.contains("owner")) tickets.createIndex("owner", "owner", { unique: false });

        let catalog;
        if (!db.objectStoreNames.contains("catalog")) catalog = db.createObjectStore("catalog", { keyPath: "opId" });
        else catalog = request.transaction.objectStore("catalog");
        if (!catalog.indexNames.contains("owner")) catalog.createIndex("owner", "owner", { unique: false });

        let settings;
        if (!db.objectStoreNames.contains("settings")) settings = db.createObjectStore("settings", { keyPath: "owner" });
        else settings = request.transaction.objectStore("settings");
        if (!settings.indexNames.contains("owner")) settings.createIndex("owner", "owner", { unique: true });

        let history;
        if (!db.objectStoreNames.contains("history")) history = db.createObjectStore("history", { keyPath: "key" });
        else history = request.transaction.objectStore("history");
        if (!history.indexNames.contains("owner")) history.createIndex("owner", "owner", { unique: false });
        if (!history.indexNames.contains("ownerCreated")) history.createIndex("ownerCreated", ["owner", "createdAt", "ticketId"], { unique: false });
        if (!history.indexNames.contains("ownerMonthCreated")) history.createIndex("ownerMonthCreated", ["owner", "month", "createdAt", "ticketId"], { unique: false });
        if (!history.indexNames.contains("ownerTicketNo")) history.createIndex("ownerTicketNo", ["owner", "ticketNo"], { unique: false });

        if (!db.objectStoreNames.contains("sequences")) {
          const sequences = db.createObjectStore("sequences", { keyPath: "key" });
          sequences.createIndex("owner", "owner", { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("Không mở được bộ nhớ offline."));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(new Error("Bộ nhớ offline đang được mở ở tab khác; hãy đóng tab cũ rồi thử lại."));
      };
    });
    return dbPromise;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Không đọc được dữ liệu offline."));
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Không ghi được dữ liệu offline."));
      tx.onabort = () => reject(tx.error || new Error("Giao dịch offline đã bị hủy."));
    });
  }

  function safeOwner(owner) {
    const value = String(owner || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(value)) throw new Error("Tên tài khoản offline không hợp lệ.");
    return value;
  }

  function safeTicketId(ticket) {
    const id = String(ticket?.id || "");
    if (!id || id.length > 128) throw new Error("Phiếu offline thiếu mã định danh.");
    return id;
  }

  function ticketMonth(ticket) {
    const raw = String(ticket?.ngayGiao || "").trim();
    const iso = raw.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}`;
    const dmy = raw.match(/^\d{1,2}[/. -](\d{1,2})[/. -](\d{4})$/);
    if (dmy) return `${dmy[3]}-${String(dmy[1]).padStart(2, "0")}`;
    const date = new Date(ticket?.createdAt || ticket?.updatedAt || 0);
    if (!Number.isFinite(date.getTime())) return "0000-00";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(date);
    const fields = Object.fromEntries(parts.map(item => [item.type, item.value]));
    return `${fields.year}-${fields.month}`;
  }

  function historyEntry(owner, ticket) {
    const ticketId = safeTicketId(ticket);
    const saved = { ...ticket, id: ticketId, ownerUsername: ticket.ownerUsername || owner };
    const createdAt = String(saved.createdAt || saved.updatedAt || saved.ngayGiao || new Date(0).toISOString());
    return {
      key: `${owner}::${ticketId}`,
      owner,
      ticketId,
      ticketNo: String(saved.soPhieu || "").trim().toLowerCase(),
      month: ticketMonth(saved),
      createdAt,
      ticket: saved,
    };
  }

  function ownerRange(owner) {
    return IDBKeyRange.only(owner);
  }

  function monthRange(owner, month) {
    return IDBKeyRange.bound([owner, month, "", ""], [owner, month, "\uffff", "\uffff"]);
  }

  function historyCursorRange(owner, cursor) {
    if (!cursor) return IDBKeyRange.bound([owner, "", ""], [owner, "\uffff", "\uffff"]);
    return IDBKeyRange.bound([owner, "", ""], [owner, cursor.createdAt, cursor.id], false, true);
  }

  async function listByOwner(storeName, owner) {
    const db = await openDb();
    const tx = db.transaction(storeName, "readonly");
    const done = transactionDone(tx);
    const result = await requestResult(tx.objectStore(storeName).index("owner").getAll(safeOwner(owner)));
    await done;
    return result.sort((a, b) => String(a.queuedAt || a.updatedAt).localeCompare(String(b.queuedAt || b.updatedAt)));
  }

  async function countHistoryMatches(owner, month, query) {
    const db = await openDb();
    const tx = db.transaction("history", "readonly");
    const done = transactionDone(tx);
    const store = tx.objectStore("history");
    const q = String(query || "").trim().toLowerCase();
    const range = month ? monthRange(owner, month) : IDBKeyRange.bound([owner, "", ""], [owner, "\uffff", "\uffff"]);
    if (!q) {
      const index = store.index(month ? "ownerMonthCreated" : "ownerCreated");
      const count = await requestResult(index.count(range));
      await done;
      return count;
    }
    const index = store.index(month ? "ownerMonthCreated" : "ownerCreated");
    const request = index.openCursor(range, "next");
    let count = 0;
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error || new Error("Không đếm được lịch sử offline."));
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return resolve();
        if (String(cursor.value.ticketNo || "").includes(q)) count++;
        cursor.continue();
      };
    });
    await done;
    return count;
  }

  async function listHistoryMonths(owner) {
    const db = await openDb();
    const tx = db.transaction("history", "readonly");
    const done = transactionDone(tx);
    const request = tx.objectStore("history").index("ownerMonthCreated").openKeyCursor(
      IDBKeyRange.bound([owner, "", "", ""], [owner, "\uffff", "\uffff", "\uffff"]),
      "next",
    );
    const months = new Set();
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error || new Error("Không đọc được các tháng trong lịch sử."));
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return resolve();
        if (Array.isArray(cursor.key) && cursor.key[1]) months.add(String(cursor.key[1]));
        cursor.continue();
      };
    });
    await done;
    return [...months].sort((a, b) => b.localeCompare(a));
  }

  const api = {
    async putTicket(owner, ticket) {
      owner = safeOwner(owner);
      if (!ticket || typeof ticket !== "object") throw new Error("Phiếu offline không hợp lệ.");
      const db = await openDb();
      const tx = db.transaction("tickets", "readwrite");
      const store = tx.objectStore("tickets");
      const key = `${owner}::${safeTicketId(ticket)}`;
      const previous = await requestResult(store.get(key));
      const entry = { key, owner, ticket, queuedAt: previous?.queuedAt || new Date().toISOString() };
      store.put(entry);
      await transactionDone(tx);
      return entry;
    },
    async listTickets(owner) { return listByOwner("tickets", owner); },
    async deleteTicket(owner, ticketId) {
      const db = await openDb();
      const tx = db.transaction("tickets", "readwrite");
      tx.objectStore("tickets").delete(`${safeOwner(owner)}::${String(ticketId)}`);
      await transactionDone(tx);
    },
    async putCatalogOperation(owner, type, item) {
      owner = safeOwner(owner);
      if (!( ["customer", "product"].includes(type)) || !item || typeof item !== "object") throw new Error("Thao tác danh mục offline không hợp lệ.");
      const opId = `${owner}:${type}:${crypto.randomUUID()}`;
      const operation = { opId, owner, type, item, queuedAt: new Date().toISOString() };
      const db = await openDb();
      const tx = db.transaction("catalog", "readwrite");
      tx.objectStore("catalog").put(operation);
      await transactionDone(tx);
      return operation;
    },
    async listCatalogOperations(owner) { return listByOwner("catalog", owner); },
    async deleteCatalogOperation(opId) {
      const db = await openDb();
      const tx = db.transaction("catalog", "readwrite");
      tx.objectStore("catalog").delete(String(opId));
      await transactionDone(tx);
    },
    async putSettingsOperation(owner, settings) {
      owner = safeOwner(owner);
      const operation = { owner, settings, updatedAt: new Date().toISOString() };
      const db = await openDb();
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put(operation);
      await transactionDone(tx);
      return operation;
    },
    async listSettingsOperations(owner) { return listByOwner("settings", owner); },
    async deleteSettingsOperation(owner) {
      const db = await openDb();
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").delete(safeOwner(owner));
      await transactionDone(tx);
    },
    async putHistory(owner, ticket) {
      owner = safeOwner(owner);
      const entry = historyEntry(owner, ticket);
      const db = await openDb();
      const tx = db.transaction("history", "readwrite");
      tx.objectStore("history").put(entry);
      await transactionDone(tx);
      return entry.ticket;
    },
    async getHistory(owner, ticketId) {
      const db = await openDb();
      const tx = db.transaction("history", "readonly");
      const done = transactionDone(tx);
      const entry = await requestResult(tx.objectStore("history").get(`${safeOwner(owner)}::${String(ticketId)}`));
      await done;
      return entry?.ticket || null;
    },
    async findHistoryByTicketNumber(owner, ticketNo) {
      const db = await openDb();
      const tx = db.transaction("history", "readonly");
      const done = transactionDone(tx);
      const entry = await requestResult(tx.objectStore("history").index("ownerTicketNo").get([safeOwner(owner), String(ticketNo || "").trim().toLowerCase()]));
      await done;
      return entry?.ticket || null;
    },
    async listHistory(owner) {
      const db = await openDb();
      const tx = db.transaction("history", "readonly");
      const done = transactionDone(tx);
      const entries = await requestResult(tx.objectStore("history").index("owner").getAll(safeOwner(owner)));
      await done;
      return entries.map(entry => entry.ticket).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    },
    async verifyHistoryBatch(owner, tickets) {
      owner = safeOwner(owner);
      const rows = Array.isArray(tickets) ? tickets : [];
      const db = await openDb();
      const tx = db.transaction("history", "readonly");
      const done = transactionDone(tx);
      const store = tx.objectStore("history");
      const checks = rows.map(ticket => {
        if (!ticket || typeof ticket !== "object" || !ticket.id) return Promise.resolve({ ok: false, reason: "missing" });
        const id = String(ticket.id);
        const expected = { ...ticket, id, ownerUsername: ticket.ownerUsername || owner };
        return requestResult(store.get(`${owner}::${id}`)).then(entry => {
          if (!entry) return { ok: false, reason: "missing" };
          return JSON.stringify(entry.ticket) === JSON.stringify(expected)
            ? { ok: true }
            : { ok: false, reason: "mismatch" };
        });
      });
      const results = await Promise.all(checks);
      await done;
      return {
        ok: results.every(result => result.ok),
        verified: results.filter(result => result.ok).length,
        missing: results.filter(result => result.reason === "missing").length,
        mismatched: results.filter(result => result.reason === "mismatch").length,
      };
    },
    async listHistoryPage(owner, options = {}) {
      owner = safeOwner(owner);
      const limit = Math.max(1, Math.min(100, Number.isFinite(Number(options.limit)) ? Math.floor(Number(options.limit)) : 60));
      const query = String(options.query || "").trim().toLowerCase();
      let cursor = null;
      if (options.cursor) {
        try {
          const parsed = JSON.parse(String(options.cursor));
          if (typeof parsed?.createdAt === "string" && typeof parsed?.id === "string") cursor = parsed;
        } catch {}
      }
      const month = /^\d{4}-\d{2}$/.test(String(options.month || "")) ? String(options.month) : "";
      const db = await openDb();
      const tx = db.transaction("history", "readonly");
      const done = transactionDone(tx);
      const store = tx.objectStore("history");
      const index = store.index(month ? "ownerMonthCreated" : "ownerCreated");
      const range = month
        ? (cursor
          ? IDBKeyRange.bound([owner, month, "", ""], [owner, month, cursor.createdAt, cursor.id], false, true)
          : monthRange(owner, month))
        : historyCursorRange(owner, cursor);
      const request = index.openCursor(range, "prev");
      const entries = [];
      await new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error || new Error("Không đọc được trang lịch sử offline."));
        request.onsuccess = event => {
          const item = event.target.result;
          if (!item) return resolve();
          if (!query || String(item.value.ticketNo || "").includes(query)) entries.push(item.value);
          if (entries.length >= limit + 1) return resolve();
          item.continue();
        };
      });
      await done;
      const hasMore = entries.length > limit;
      const page = entries.slice(0, limit);
      const last = page[page.length - 1];
      const [total, months] = await Promise.all([
        countHistoryMatches(owner, month, query),
        listHistoryMonths(owner),
      ]);
      return {
        tickets: page.map(entry => entry.ticket),
        hasMore,
        nextCursor: hasMore && last ? JSON.stringify({ createdAt: last.createdAt, id: last.ticketId }) : null,
        total,
        months,
        limit,
      };
    },
    async importHistory(owner, tickets) {
      owner = safeOwner(owner);
      let imported = 0;
      let rejected = 0;
      const rows = Array.isArray(tickets) ? tickets : [];
      for (let offset = 0; offset < rows.length; offset += 100) {
        const sourceChunk = rows.slice(offset, offset + 100);
        const chunk = sourceChunk.filter(ticket => ticket && typeof ticket === "object" && ticket.id);
        rejected += sourceChunk.length - chunk.length;
        const db = await openDb();
        const tx = db.transaction("history", "readwrite");
        const store = tx.objectStore("history");
        for (const ticket of chunk) {
          let entry;
          try { entry = historyEntry(owner, ticket); } catch { rejected++; continue; }
          const request = store.get(entry.key);
          request.onsuccess = () => {
            if (request.result) { rejected++; return; }
            store.put(entry);
            imported++;
          };
          request.onerror = () => { rejected++; };
        }
        await transactionDone(tx);
      }
      return { imported, rejected };
    },
    async deleteHistory(owner, ticketId) {
      const db = await openDb();
      const tx = db.transaction("history", "readwrite");
      tx.objectStore("history").delete(`${safeOwner(owner)}::${String(ticketId)}`);
      await transactionDone(tx);
    },
    async deleteHistoryMonth(owner, month) {
      owner = safeOwner(owner);
      if (!/^\d{4}-\d{2}$/.test(String(month || ""))) throw new Error("Tháng cần xóa không hợp lệ.");
      const db = await openDb();
      const tx = db.transaction("history", "readwrite");
      const request = tx.objectStore("history").index("ownerMonthCreated").openCursor(monthRange(owner, month));
      let deleted = 0;
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.delete();
        deleted++;
        cursor.continue();
      };
      await transactionDone(tx);
      return deleted;
    },
    async deleteAllHistory(owner) {
      owner = safeOwner(owner);
      const db = await openDb();
      const tx = db.transaction("history", "readwrite");
      const request = tx.objectStore("history").index("owner").openCursor(ownerRange(owner));
      let deleted = 0;
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.delete();
        deleted++;
        cursor.continue();
      };
      await transactionDone(tx);
      return deleted;
    },
    async reserveTicketNumber(owner, period, minimumSequence = 0) {
      owner = safeOwner(owner);
      period = String(period || "");
      if (!/^\d{4}$/.test(period) || Number(period.slice(2)) < 1 || Number(period.slice(2)) > 12) throw new Error("Kỳ đánh số phiếu không hợp lệ.");
      const minimum = Number.isSafeInteger(Number(minimumSequence)) ? Math.max(0, Number(minimumSequence)) : 0;
      const prefix = `PGH-${period}-`;
      const lowerPrefix = prefix.toLowerCase();
      const key = `${owner}::${period}`;
      const db = await openDb();
      const tx = db.transaction(["sequences", "history"], "readwrite");
      const sequences = tx.objectStore("sequences");
      const recordRequest = sequences.get(key);
      const cursorRequest = tx.objectStore("history").index("ownerTicketNo").openCursor(
        IDBKeyRange.bound([owner, lowerPrefix], [owner, `${lowerPrefix}\uffff`]),
        "next",
      );
      let record = null;
      let cursorFinished = false;
      let recordFinished = false;
      let maxExisting = 0;
      let ticketNo = "";
      const result = new Promise((resolve, reject) => {
        const reserveWhenReady = () => {
          if (!recordFinished || !cursorFinished) return;
          const next = Math.max(Number(record?.lastSeq || 0), maxExisting, minimum) + 1;
          sequences.put({ key, owner, period, lastSeq: next, updatedAt: new Date().toISOString() });
          ticketNo = `${prefix}${String(next).padStart(4, "0")}`;
          resolve(ticketNo);
        };
        recordRequest.onsuccess = () => { record = recordRequest.result || null; recordFinished = true; reserveWhenReady(); };
        recordRequest.onerror = () => reject(recordRequest.error || new Error("Không đọc được bộ đếm số phiếu."));
        cursorRequest.onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) { cursorFinished = true; reserveWhenReady(); return; }
          const value = String(cursor.value.ticketNo || "");
          const numeric = Number(value.slice(prefix.length));
          if (Number.isSafeInteger(numeric)) maxExisting = Math.max(maxExisting, numeric);
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error || new Error("Không kiểm tra được số phiếu đã dùng."));
      });
      await result;
      await transactionDone(tx);
      return ticketNo;
    },
    async countPending(owner) {
      owner = safeOwner(owner);
      const db = await openDb();
      const tx = db.transaction(["tickets", "catalog", "settings"], "readonly");
      const done = transactionDone(tx);
      const [tickets, catalog, settings] = await Promise.all([
        requestResult(tx.objectStore("tickets").index("owner").count(owner)),
        requestResult(tx.objectStore("catalog").index("owner").count(owner)),
        requestResult(tx.objectStore("settings").index("owner").count(owner)),
      ]);
      await done;
      return { tickets, catalog, settings, total: tickets + catalog + settings };
    },
  };

  window.PghOfflineStorage = Object.freeze(api);
})();
