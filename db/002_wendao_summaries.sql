-- 问道 · 思考小结（沉淀）。落中台共享 PG，wendao_ 前缀。
-- user_id = 深脑 Supabase 用户 id（两边同一套账号），故深脑可用同一 id 直接读。
-- 无 RLS：wendao 服务端用登录态 user_id 强制作用域；深脑侧读时自行按登录用户过滤。
create table if not exists public.wendao_summaries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  title       text not null default '',
  judgments   jsonb not null default '[]'::jsonb,  -- [{type,text,basis}]
  takeaway    text not null default '',
  local_id    text,                                 -- 客户端本地 id，用于去重
  created_at  timestamptz not null default now()
);
create index if not exists wendao_summaries_user_created_idx
  on public.wendao_summaries (user_id, created_at desc);
-- 同一用户同一条本地小结只入库一次
create unique index if not exists wendao_summaries_user_local_uniq
  on public.wendao_summaries (user_id, local_id) where local_id is not null;
