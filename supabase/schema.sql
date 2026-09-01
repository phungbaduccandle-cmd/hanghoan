-- Chạy toàn bộ file này trong Supabase Dashboard -> SQL Editor -> New query -> Run
-- (Dùng chung project Supabase "Quanlyshop" hiện tại của bạn cũng được — các bảng
--  dưới đây đặt tên riêng với tiền tố hang_hoan_ nên sẽ không trùng với bảng nào
--  bạn đã có sẵn.)

create table if not exists hang_hoan_returns (
  id text primary key,
  order_code text not null,
  sku text,
  product_name text,
  request_date timestamptz,
  quantity numeric,
  order_type text,
  reason text,
  solution_plan text,
  amount numeric,
  status text not null,
  needs_physical_return boolean default false,
  ready_to_scan boolean default false,
  source text,
  received_date timestamptz,
  item_condition text,
  month text,
  created_at timestamptz default now(),
  shop text
);

alter table hang_hoan_returns add column if not exists shop text;

create index if not exists idx_hang_hoan_returns_order_code on hang_hoan_returns (order_code);

create table if not exists hang_hoan_settings (
  key text primary key,
  value jsonb not null
);

insert into hang_hoan_settings (key, value)
values ('overdue_days', '15')
on conflict (key) do nothing;

create table if not exists hang_hoan_file_history (
  id text primary key,
  file_name text,
  file_type text,
  storage_path text,
  row_count integer,
  added_count integer,
  skipped_count integer,
  uploaded_at timestamptz default now()
);

create index if not exists idx_hang_hoan_file_history_uploaded_at on hang_hoan_file_history (uploaded_at);

-- Cho phép ứng dụng web (dùng anon key) đọc/ghi bảng này.
-- Đây là công cụ nội bộ dùng trong nhóm, chưa có đăng nhập riêng từng nhân viên,
-- nên tạm thời mở quyền đọc/ghi cho anon key (giống hệt cách dữ liệu đang được
-- chia sẻ trong Claude hiện tại). Nếu sau này cần giới hạn, có thể bật lại RLS
-- và viết policy theo tài khoản đăng nhập.
alter table hang_hoan_returns enable row level security;
alter table hang_hoan_settings enable row level security;
alter table hang_hoan_file_history enable row level security;

create policy "allow all - hang_hoan_returns" on hang_hoan_returns
  for all using (true) with check (true);

create policy "allow all - hang_hoan_settings" on hang_hoan_settings
  for all using (true) with check (true);

create policy "allow all - hang_hoan_file_history" on hang_hoan_file_history
  for all using (true) with check (true);

-- Chống trùng dữ liệu ở tầng database: app dùng upsert(onConflict: 'order_code,sku')
-- khi thêm/nhập đơn, cần ràng buộc UNIQUE này để onConflict khớp đúng.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hang_hoan_returns_order_code_sku_key'
  ) then
    alter table hang_hoan_returns
      add constraint hang_hoan_returns_order_code_sku_key unique (order_code, sku);
  end if;
end $$;
