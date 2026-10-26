# QT Document Workflow

Ứng dụng chạy cùng một origin: giao diện trong `public/` gọi Express API, API xác thực người dùng và lưu nghiệp vụ trong PostgreSQL. Không mở HTML bằng `file://`; máy chủ chỉ phục vụ danh sách trang/tài nguyên giao diện đã cho phép, không phục vụ thư mục dữ liệu `DataApp`, file `.env` hoặc mã SQL.

## Yêu cầu

- Node.js 20 trở lên và npm.
- PostgreSQL đang chạy. Cấu hình hiện có của dự án dùng cổng `54321`; database trong pgAdmin là `bqp_documents`.

## Kết nối PostgreSQL lần đầu

1. Tạo role riêng cho ứng dụng trong pgAdmin **Query Tool** (thay mật khẩu mẫu bằng mật khẩu riêng):

```sql
CREATE ROLE qt_app LOGIN PASSWORD 'THAY_BANG_MAT_KHAU_RIENG';
GRANT CONNECT ON DATABASE bqp_documents TO qt_app;
GRANT USAGE ON SCHEMA public TO qt_app;
```

2. Tại database `bqp_documents`, chạy nội dung `schema.sql` bằng tài khoản quản trị/migration trong Query Tool. Sau khi cài Node và cấu hình `.env`, cũng có thể khởi tạo bằng `npm.cmd run db:setup` với `MIGRATION_DATABASE_URL`.

3. Cấp quyền dữ liệu hiện có cho role ứng dụng trong Query Tool:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON users, drafts, word_templates, documents, document_notes, attachments, qt_sessions, military_ranks, positions TO qt_app;
GRANT USAGE, SELECT ON SEQUENCE military_ranks_id_seq, positions_id_seq TO qt_app;
```

Các lần thay đổi schema sau này chạy bằng tài khoản migration, không chạy ứng dụng với tài khoản `postgres`.

## Cài đặt và khởi động

Trong PowerShell, tại thư mục dự án:

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
npm.cmd install
Copy-Item .env.example .env
```

Mở `.env` và đặt `DATABASE_URL` theo mật khẩu role `qt_app`, `MIGRATION_DATABASE_URL` theo tài khoản migration; đặt `SESSION_SECRET` thành chuỗi ngẫu nhiên dài tối thiểu 32 ký tự. Không chia sẻ hoặc commit `.env`.

Khởi tạo tài khoản demo tùy chọn:

```powershell
npm.cmd run db:seed-demo
```

Lệnh trên tạo/cập nhật tên và cấp demo nhưng không ghi đè mật khẩu hiện hữu. Không chạy seed demo trong database thật. Các tài khoản/mật khẩu demo được liệt kê trong `tai-khoan-demo.txt`; chỉ dùng trên máy thử nghiệm và đổi ngay nếu đưa vào môi trường khác.

Khởi động máy chủ:

```powershell
npm.cmd start
```

Mở `http://127.0.0.1:3000`. Endpoint kiểm tra kết nối là `http://127.0.0.1:3000/api/health`.

### Dùng trong mạng nội bộ

- Trên máy chủ, đặt `HOST=0.0.0.0` trong `.env` rồi khởi động lại ứng dụng. Mặc định máy chủ chỉ lắng nghe trên `127.0.0.1`; giữ mặc định này nếu chỉ dùng trên máy chủ.
- Cho phép cổng `3000` qua Windows Defender Firewall chỉ trên profile **Private** của mạng nội bộ, không trên Public. PostgreSQL nên tiếp tục chỉ nhận kết nối từ máy chủ trừ khi có nhu cầu riêng.
- Máy chủ và máy người dùng phải cùng mạng/VPN nội bộ. Người dùng mở `http://<IPv4-máy-chủ>:3000`, ví dụ `http://192.168.101.8:3000`. Nên đặt IP tĩnh hoặc DHCP reservation để địa chỉ không đổi.
- Dùng cùng một địa chỉ máy chủ xuyên suốt; không đăng nhập lúc bằng IP, lúc bằng tên máy vì cookie phiên gắn với host đã truy cập.

## Cấu trúc gọn

- `public/`: toàn bộ HTML, CSS, JavaScript giao diện và ảnh.
- Tài khoản quản lý dùng `public/quan-ly.html` để tạo, tìm kiếm, sửa tài khoản thành viên và đặt lại mật khẩu; cấp bậc, chức vụ được chọn từ danh mục. Danh sách cấp bậc sắp xếp từ cao xuống thấp (tướng, tá, úy, sĩ, binh). Dùng `public/danh-muc.html` để thêm cấp bậc và chức vụ (chức vụ mới gắn với một trong năm cấp duyệt hiện tại); `public/mau-word.html` để tải lên/quản lý mẫu Word.
- Người dùng gửi giáo án tại `public/gui-giao-an.html`: nhập tiêu đề, chọn loại giáo án và người nhận, tải lên ít nhất một tệp Word (`.doc`/`.docx`) hoặc PDF. Tệp gốc được lưu và chuyển tiếp nguyên byte, không chuyển đổi định dạng; giới hạn 15 MB mỗi tệp.
- Nội dung giáo án Quân sự gồm: Pháo binh, Công binh, Bộ binh, Trinh sát, Thông tin, SPG, Cối 60 và Cối 80.
- Mẫu Word được tải nguyên bản về để hoàn thiện trong Microsoft Word rồi tải lên gửi duyệt. Ứng dụng không còn trình soạn giáo án bằng chữ trên web hoặc mẫu soạn nội dung chữ.

Khi cập nhật phiên bản, chạy `npm.cmd run db:setup` bằng tài khoản migration. Migration file-submission sẽ xóa các bản nháp và mẫu soạn chữ cũ, xóa nội dung chữ khỏi giáo án lịch sử và loại bỏ cột nội dung; lịch sử phê duyệt, ghi chú, tệp đã gửi, tài khoản và mẫu Word được giữ lại. Cấp quyền đọc/ghi bảng `users`, `drafts`, `word_templates`, `documents`, `document_notes`, `attachments`, `qt_sessions`, `military_ranks` và `positions` cho role `qt_app`; cấp quyền dùng sequence `military_ranks_id_seq` và `positions_id_seq`.
- `server.js`: backend Express API.
- `schema.sql`, `setup-db.js`, `seed-demo.js`: cấu trúc và thao tác dữ liệu PostgreSQL.
- `.env`: cấu hình bí mật riêng trên máy, không chia sẻ/commit.

## API chính

- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/recipients`, `GET|POST /api/documents`
- `POST /api/documents/:id/notes`, `POST /api/documents/:id/approve`, `POST /api/documents/:id/reject`
- `GET|POST /api/drafts`, `DELETE /api/drafts/:id`, `POST /api/drafts/:id/attachments`
- `GET /api/attachments/:id`
- `GET|POST /api/management/users`, `PUT /api/management/users/:id`, `POST /api/management/users/:id/reset-password` (chỉ quản lý)
- `GET /api/management/catalogs`, `POST|DELETE /api/management/catalogs/ranks`, `POST|DELETE /api/management/catalogs/positions` (chỉ quản lý)
- `GET /api/word-templates`, `GET /api/word-templates/:id/download` (tài khoản gửi giáo án)
- `GET|POST /api/management/word-templates`, `DELETE /api/management/word-templates/:id` (chỉ quản lý)

Phiên đăng nhập được lưu trong PostgreSQL; cookie HTTP-only/SameSite. Mật khẩu được băm bcrypt. Backend kiểm tra quyền gửi/duyệt và không cho tài khoản quản lý gửi/duyệt giáo án. Tệp giáo án và mẫu Word được lưu trong cột `BYTEA` (giới hạn 15 MB/tệp).

Đăng nhập giới hạn tối đa 10 lần thất bại trong 5 phút trên mỗi địa chỉ IP; lần đăng nhập thành công không làm tăng bộ đếm.

## Triển khai thật

Đổi toàn bộ mật khẩu demo, dùng HTTPS, đặt `NODE_ENV=production`, tạo `SESSION_SECRET` riêng, bật TLS cho PostgreSQL khi database ở máy khác và hạn chế mạng truy cập database/API. Dữ liệu trình duyệt cũ trong localStorage/IndexedDB không tự được chuyển; hãy sao lưu và nhập lại theo quy trình được kiểm soát trước khi xóa dữ liệu cũ.
