# BK SpaceTech — Localhost CMS

## Chạy ứng dụng

Ứng dụng cần Node.js 24 trở lên và phải chạy qua `server.mjs` để bảo vệ Dashboard. Không dùng VS Code Live Server hoặc `python -m http.server`, vì các máy chủ tĩnh này không xác thực Google và không khóa được `dashboard.html`.

1. Tạo Google OAuth Client ID trong Google Cloud Console, bật Google Identity Services và thêm Authorized JavaScript origin:
   - `http://127.0.0.1:8000`
2. Tại thư mục dự án, cài dependencies:
   ```powershell
   npm install
   ```
3. Tạo cấu hình cục bộ từ mẫu rồi điền Client ID:
   ```powershell
   Copy-Item .env.example .env
   ```
   Mở `.env` và đặt `GOOGLE_CLIENT_ID=...apps.googleusercontent.com`.
4. Khởi động máy chủ:
   ```powershell
   npm start
   ```
5. Mở `http://127.0.0.1:8000/trangchu.html`. Trang tự yêu cầu Google xác thực với auto-select; không hiển thị nút đăng nhập Google riêng. Khi Google xác minh tài khoản đã được cấp quyền, bấm “Dashboard” và nhập mật khẩu Dashboard (`abc123` theo cấu hình mẫu). Dashboard hiển thị ngay trong trang chủ; dùng nút “Xem Trang chủ” để khóa Dashboard hoặc “Đăng xuất” để kết thúc phiên Google.

Google chỉ tự chọn tài khoản khi trình duyệt cho phép Google Identity Services và tài khoản đã cấp quyền cho ứng dụng trước đó. Lần đầu dùng ứng dụng, Google có thể yêu cầu chọn tài khoản hoặc xác nhận quyền; website không thể tự đọc tài khoản đang đăng nhập trong hồ sơ Chrome.

Nếu cần dùng cổng khác, thêm `PORT=...` vào `.env` và khai báo đúng origin đó trong Google Cloud Console.

## Apache (`.htaccess`)

Tệp `.htaccess` chuyển tiếp toàn bộ yêu cầu Apache tới ứng dụng Node.js ở `127.0.0.1:8000`, để các API và kiểm tra quyền Dashboard vẫn được xử lý bởi máy chủ ứng dụng. Cần bật `mod_rewrite`, `mod_proxy`, `mod_proxy_http` và cho phép `.htaccess` dùng `AllowOverride FileInfo AuthConfig Options`. Node.js phải chạy trên cùng máy chủ; nếu đổi cổng, sửa cả `PORT` trong `.env` và địa chỉ đích trong `.htaccess`. Không dùng cấu hình này trên hosting chỉ phục vụ tệp tĩnh hoặc khi Apache không được phép proxy; không được bỏ qua Node.js để phục vụ trực tiếp `dashboard.html`.

## SQL schema

Ứng dụng dùng Microsoft SQL Server làm cơ sở dữ liệu chính. Schema T-SQL trong `database/schema.sql` được áp dụng tự động khi chạy `npm start`; database phải được tạo trước và tài khoản kết nối cần quyền tạo bảng/chỉ mục. Nếu chạy schema từ SSMS khi đang chọn `master`, script sẽ tự chuyển sang `bkspacetech_cms`. Hỗ trợ SQL Server 2012 trở lên.

Tạo database một lần trong SQL Server Management Studio hoặc `sqlcmd`:

```powershell
sqlcmd -S ".\SQLEXPRESS" -E -Q "CREATE DATABASE [bkspacetech_cms]"
```

Sao chép `.env.example` thành `.env` rồi đặt thông tin SQL Server. Mặc định dùng Windows Authentication với `localhost\SQLEXPRESS`; dùng `DB_AUTH=sql` cùng `DB_USER`/`DB_PASSWORD` nếu SQL Server bật SQL Authentication. Có thể chạy lại schema an toàn; các bảng và dữ liệu hiện có không bị xóa.

Để chuyển dữ liệu hiện có từ SQLite sang SQL Server, chạy một lần:

```powershell
npm run migrate:sqlserver
```

Lệnh này nhập dữ liệu từ `data/bkspacetech.sqlite` vào SQL Server, cập nhật các bản ghi trùng khóa và không xóa dữ liệu chỉ có ở SQL Server. Sao lưu database trước khi nhập. Nếu bảng `dbo.users` còn trống, ứng dụng tạo whitelist ban đầu từ danh sách mặc định trong `server.mjs`; audit log lịch sử được nhập từ SQLite.

Để xuất dữ liệu SQL Server thành các collection JSON tương thích MongoDB, chạy:

```powershell
npm run export:mongodb
```

Mỗi bảng được xuất thành một tệp trong `data/mongodb-export/`; ngày giờ dùng MongoDB Extended JSON và các cột JSON được chuyển thành object. Đây chỉ là bản xuất, ứng dụng vẫn đọc/ghi SQL Server.

Để nhập các tệp này lên MongoDB Atlas:

1. Đặt `MONGODB_URI` trong `.env` cục bộ bằng URI lấy từ Atlas, thay mật khẩu giữ chỗ bằng mật khẩu thật và mã hóa URL các ký tự đặc biệt. Không gửi URI hoặc commit `.env`.
2. Tại thư mục dự án, chạy lệnh sau trong PowerShell:

```powershell
npm run import:mongodb
```

Lệnh này đọc MongoDB Extended JSON, giữ đúng kiểu ngày giờ, rồi upsert các tài liệu theo `_id`. Không cần dán mã JavaScript vào PowerShell hoặc cài `mongoimport`. Tệp xuất có email và nhật ký hoạt động; không commit hoặc chia sẻ công khai chúng.

`cms_state` lưu trạng thái CMS có kiểm soát xung đột; các bảng nội dung chuẩn hóa, users, roles, permissions và audit_logs đều nằm trong SQL Server. Bài viết/hoạt động và đào tạo mới được đăng theo quyền hiện hành.

## Whitelist và phân quyền

Danh sách whitelist khởi tạo mặc định gồm:

- `quan.nm@bkspacetech.com` — Admin
- `vuvietvan26032006@gmail.com` — Admin
- `kiet.lt225034@sis.hust.edu.vn` — Trưởng/phó ban
- `ha.pt236411@sis.hust.edu.vn` — Thành viên ủy quyền

Admin có thể cấp quyền tài khoản mới, chọn vai trò và khóa/mở tài khoản trong Dashboard; whitelist được kiểm tra và lưu trong SQL Server. Nhật ký cấp quyền, mở/khóa tài khoản và mở Dashboard được lưu trong SQL Server. Không chỉnh whitelist bằng localStorage để cấp quyền.

Các khu vực Dashboard gồm bài viết, danh mục, dự án, hoạt động, đào tạo (lọc từ các hoạt động có loại `training`), nhân sự, cơ cấu ban, media, nhà tài trợ, lịch sử chỉnh sửa, nhật ký hoạt động và tài khoản/cấu hình. Khi thêm bài viết hoặc hoạt động/đào tạo, bản ghi được xuất bản trực tiếp và trang chủ tải lại nội dung từ SQL Server. Vai trò hiển thị là “Thành viên ủy quyền” và “Trưởng/phó ban”; mã vai trò và quyền hiện hành được giữ nguyên.

Mật khẩu mặc định `abc123` chỉ phù hợp cho bản thử nghiệm localhost; thay đổi `DASHBOARD_PASSWORD` trong `.env` nếu triển khai ở môi trường khác. Phiên đăng nhập được lưu trong cookie `HttpOnly`, hết hạn sau 8 giờ. Sao lưu SQL Server database thường xuyên.
