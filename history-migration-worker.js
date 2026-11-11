"use strict";

let historyRows = [];
let nextOffset = 0;
const BATCH_SIZE = 100;

function sendNextBatch() {
  if (nextOffset >= historyRows.length) {
    self.postMessage({ type: "complete", total: historyRows.length });
    historyRows = [];
    return;
  }
  const batch = historyRows.slice(nextOffset, nextOffset + BATCH_SIZE);
  const offset = nextOffset;
  nextOffset += batch.length;
  self.postMessage({ type: "batch", offset, batch });
}

self.onmessage = event => {
  const message = event.data || {};
  if (message.type === "abort") {
    historyRows = [];
    close();
    return;
  }
  if (message.type === "ack") {
    sendNextBatch();
    return;
  }
  if (message.type !== "start") return;

  try {
    const saved = JSON.parse(String(message.raw || "{}"));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Dữ liệu lịch sử cũ không đúng định dạng.");
    historyRows = Array.isArray(saved.history) ? saved.history : [];
    const meta = {
      customers: Array.isArray(saved.customers) ? saved.customers : [],
      catalog: Array.isArray(saved.catalog) ? saved.catalog : [],
      audit: Array.isArray(saved.audit) ? saved.audit.slice(0, 500) : [],
      settings: saved.settings && typeof saved.settings === "object" ? saved.settings : {},
      usedTicketNumbers: saved.usedTicketNumbers && typeof saved.usedTicketNumbers === "object" ? saved.usedTicketNumbers : {},
    };
    self.postMessage({ type: "begin", total: historyRows.length, meta });
    sendNextBatch();
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || "Không đọc được dữ liệu localStorage cũ." });
  }
};
