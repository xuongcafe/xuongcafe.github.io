RUNAM – PHIẾU GIAO HÀNG OFFLINE (2.6.2)

CÀI TRÊN iPHONE
1. Mở liên kết PWA qua HTTPS bằng Safari khi có Internet; đợi ứng dụng tải đầy đủ. Chọn Chia sẻ > Thêm vào Màn hình chính.
2. Mở ứng dụng vừa thêm khi còn Internet ít nhất một lần để tải app shell và service worker. Sau đó có thể thử bật Chế độ máy bay.
3. Nếu đã cài bản cũ, đóng rồi mở lại khi có Internet để service worker thay cache. Không xóa dữ liệu website/Safari trong lúc cập nhật.

DỮ LIỆU VÀ TỐC ĐỘ
- Phiếu, khách hàng, sản phẩm và hàng đợi offline lưu trên thiết bị bằng IndexedDB; danh sách lịch sử tải theo từng trang để hạn chế dùng RAM.
- Lần nâng cấp đầu, lịch sử localStorage cũ được phân tích ở Web Worker, chuyển từng lô 100 phiếu và xác minh lại trước khi xóa bản localStorage cũ. Không xóa dữ liệu cũ nếu xác minh thất bại. Nên xuất JSON/backup trước khi nâng cấp.
- Ứng dụng đã biên dịch JSX thành app.js; không chạy Babel trong trình duyệt khi mở app.
- Ô mã sản phẩm/khách hàng để trống không dựng toàn bộ danh mục; khi nhập chỉ hiện tối đa 30 gợi ý, vẫn hỗ trợ nhập tay, chọn mã khớp chính xác và quét mã.
- Không có nút dọn rác thủ công trong bản mobile; service worker tự xóa cache cũ khi nâng phiên bản. Không xóa dữ liệu website/Safari để “dọn rác”, vì thao tác đó có thể xóa phiếu cục bộ.
- Số phiếu theo ngày giao có dạng PGH-YYMM-NNNN; ví dụ ngày trong 10/2026 có dạng PGH-2610-0001. Bộ đếm được giữ riêng theo tháng và không quay lại số đã xóa trong cùng bộ dữ liệu.
- Đây là bản offline, dữ liệu và bộ đếm nằm trên từng thiết bị. Nhiều thiết bị tạo phiếu offline độc lập không thể bảo đảm số không trùng giữa các thiết bị; hãy dùng một nguồn cấp số online nếu cần số dùng chung.

LƯU Ý
- Xuất JSON/backup định kỳ và lưu tệp ở nơi an toàn; backup có thể chứa dữ liệu kinh doanh.
- Gói này chứa giao diện mobile offline; không chứa tài khoản online hoặc database server.
