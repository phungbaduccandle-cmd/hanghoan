# Ductin Candle — Kiểm soát hàng hoàn

Web app quản lý hàng hoàn, dùng Supabase làm nơi lưu dữ liệu thật (thay cho bộ nhớ
tạm của Claude), deploy qua Vercel bằng cách nối với GitHub.

Bạn đã có sẵn tài khoản GitHub, Vercel, Supabase — dưới đây là toàn bộ các bước,
làm lần lượt từ trên xuống.

---

## Bước 1 — Thêm bảng vào Supabase (dùng chung project "Quanlyshop" có sẵn)

Không cần tạo project Supabase mới — dùng luôn project **Quanlyshop** bạn đang có.
2 bảng mới đặt tên riêng với tiền tố `hang_hoan_` nên không đụng tới dữ liệu/bảng
sẵn có của bạn.

1. Mở project **Quanlyshop** trong Supabase Dashboard.
2. Vào **SQL Editor** (menu bên trái) → **New query**.
3. Mở file `supabase/schema.sql` trong project này, copy toàn bộ nội dung, dán vào
   SQL Editor, bấm **Run**. Việc này tạo 2 bảng: `hang_hoan_returns` (dữ liệu hàng
   hoàn) và `hang_hoan_settings` (ngưỡng quá hạn).
4. Vào **Project Settings → API** (vẫn trong project Quanlyshop). Bạn sẽ cần 2 giá
   trị ở đây cho bước 3:
   - **Project URL**
   - **anon public key**

> Lưu ý bảo mật: vì dùng chung project với dữ liệu shop tổng hợp, hãy kiểm tra các
> bảng khác trong Quanlyshop (đơn hàng, khách hàng...) đã bật **Row Level Security**
> (RLS) chưa. Anon key dùng cho app hàng hoàn là key công khai — nếu bảng nào khác
> chưa bật RLS, về lý thuyết ai có anon key cũng đọc/ghi được bảng đó. Vào **Table
> Editor**, bảng nào chưa có khoá 🔒 cạnh tên thì nên bật RLS cho bảng đó.

---

## Bước 2 — Mở project trong VS Code

1. Cài Node.js nếu máy chưa có: https://nodejs.org (bản LTS).
2. Giải nén file zip này ra 1 thư mục, mở thư mục đó bằng VS Code
   (File → Open Folder...).
3. Mở Terminal trong VS Code (Terminal → New Terminal), chạy:
   ```
   npm install
   ```

---

## Bước 3 — Nối app với Supabase

1. Trong thư mục project, copy file `.env.example` thành file mới tên `.env`
   (giữ nguyên ở thư mục gốc).
2. Mở `.env`, dán 2 giá trị lấy ở Bước 1.5 vào:
   ```
   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```
3. Chạy thử ở máy mình:
   ```
   npm run dev
   ```
   Mở link hiện ra (thường là http://localhost:5173) — app sẽ chạy, dữ liệu giờ
   lưu thật vào Supabase thay vì Claude.

---

## Bước 4 — Đẩy code lên GitHub

Trong Terminal VS Code:
```
git init
git add .
git commit -m "Khoi tao app kiem soat hang hoan"
```
Sau đó vào https://github.com/new tạo 1 repository mới (ví dụ `ductincandle-returns`),
**để trống, không tick thêm README/gitignore gì cả**. GitHub sẽ hiện sẵn 2-3 dòng
lệnh để nối — copy và chạy trong Terminal, dạng:
```
git remote add origin https://github.com/<ten-ban>/ductincandle-returns.git
git branch -M main
git push -u origin main
```

---

## Bước 5 — Deploy lên Vercel

1. Vào https://vercel.com/new, chọn **Import** repository vừa tạo ở GitHub.
2. Vercel tự nhận đây là project Vite, không cần đổi gì ở phần Build settings.
3. Trước khi bấm Deploy, mở mục **Environment Variables**, thêm đúng 2 biến
   giống file `.env` của bạn:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Bấm **Deploy**. Sau khoảng 1 phút, Vercel cho bạn 1 link dạng
   `ductincandle-returns.vercel.app` — đây là link thật, gửi cho nhân viên dùng
   trên điện thoại/máy tính đều được.

Từ giờ mỗi khi bạn sửa code và `git push` lên GitHub, Vercel sẽ tự build và
cập nhật lại link này, không cần làm lại các bước trên.

---

## Ghi chú quan trọng

- **Bảo mật**: app hiện chưa có đăng nhập riêng cho từng nhân viên — ai có link
  đều xem/sửa được dữ liệu, tương tự như khi dùng trong Claude. Nếu sau này cần
  giới hạn quyền truy cập, có thể thêm Supabase Auth (đăng nhập bằng email) và
  sửa lại policy trong `supabase/schema.sql`.
- Dữ liệu bạn đã nhập lúc dùng thử trong Claude **không tự chuyển sang** đây —
  đây là database mới, trống. Bạn cần nhập lại bằng tính năng "Nhập từ Shopee"
  hoặc "Thêm yêu cầu" trong app.
- Muốn đổi giao diện/thêm tính năng: sửa file `src/App.jsx`, lưu lại, xem trực
  tiếp ở `npm run dev`, ưng ý thì `git commit` + `git push` để Vercel tự cập nhật.
