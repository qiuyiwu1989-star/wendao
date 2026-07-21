-- 问道 · 云端会话历史
-- 接深脑自托管 Supabase（sb.ai.zaowuyun.com）。表放 public 用 wendao_ 前缀，
-- 不建独立 schema —— 这样不用改深脑 Supabase 的 PostgREST 配置、不用重启深脑的栈。
-- 全靠 RLS 保证每个用户只能读写自己的对话。幂等，可重复执行。

create table if not exists public.wendao_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default '新对话',
  messages   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wendao_conversations_user_updated_idx
  on public.wendao_conversations (user_id, updated_at desc);

alter table public.wendao_conversations enable row level security;

-- 只能操作自己的行（auth.uid() = 当前登录用户）
drop policy if exists wendao_conv_select on public.wendao_conversations;
create policy wendao_conv_select on public.wendao_conversations
  for select using (auth.uid() = user_id);

drop policy if exists wendao_conv_insert on public.wendao_conversations;
create policy wendao_conv_insert on public.wendao_conversations
  for insert with check (auth.uid() = user_id);

drop policy if exists wendao_conv_update on public.wendao_conversations;
create policy wendao_conv_update on public.wendao_conversations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists wendao_conv_delete on public.wendao_conversations;
create policy wendao_conv_delete on public.wendao_conversations
  for delete using (auth.uid() = user_id);

-- updated_at 自动维护
create or replace function public.wendao_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists wendao_conv_touch on public.wendao_conversations;
create trigger wendao_conv_touch before update on public.wendao_conversations
  for each row execute function public.wendao_touch_updated_at();

grant select, insert, update, delete on public.wendao_conversations to authenticated;
