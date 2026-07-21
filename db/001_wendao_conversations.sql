-- 问道 · 云端会话历史。落在造物中台共享 PG(zhongtai_app)，wendao_ 前缀、不碰别人的表。
-- 登录用深脑 Supabase Auth，user_id 是 Supabase 用户 id(跨库，故无 FK)。
-- 无 RLS：wendao 服务端用登录态 user_id 强制作用域。幂等。
create table if not exists public.wendao_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  title      text not null default '新对话',
  messages   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wendao_conversations_user_updated_idx
  on public.wendao_conversations (user_id, updated_at desc);
