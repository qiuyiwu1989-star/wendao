-- 问道 · 账本：那些「还在赌」的假设。
-- 定义见 COUNTERPARTY.md 职能②：判断有保质期，说过要验的到期要被翻出来问。
-- 落中台共享 PG，wendao_ 前缀，按 user_id 隔离。
create table if not exists public.wendao_bets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  claim       text not null,                    -- 赌的那个假设
  basis       text default '',                  -- 用户当时的原话
  from_title  text default '',                  -- 出自哪场对话
  due_at      timestamptz not null,             -- 到期该验了
  -- open=挂着 / held=验了成立 / broken=验了不成立 / dropped=不验了
  status      text not null default 'open',
  settled_at  timestamptz,
  note        text default '',                  -- 结账时用户补的一句
  local_id    text,                             -- 客户端去重用
  created_at  timestamptz not null default now()
);
create index if not exists wendao_bets_user_due_idx
  on public.wendao_bets (user_id, status, due_at);
create unique index if not exists wendao_bets_user_local_uniq
  on public.wendao_bets (user_id, local_id) where local_id is not null;
