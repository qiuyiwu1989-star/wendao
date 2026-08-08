-- 问道 · 思维画像：跨会话攒下来的「这个人怎么想事情」。
-- 定义见 COUNTERPARTY.md 职能③ 照出盲区：沉默比内容更有信息——
-- 反复绕开的话题、从来不问的那类问题，单场对话看不出来，只有跨会话才看得见。
-- 落中台共享 PG，wendao_ 前缀，按 user_id 隔离；一人一行，增量合并。
create table if not exists public.wendao_profile (
  user_id       uuid primary key,
  -- 画像全文。形状（缺字段按空处理，容忍模型少给）：
  --   strong   [{dim,claim,evidence}]  强信号：有对话原话作证的
  --   weak     [{dim,claim,hint}]      弱信号：像是这样但没坐实，不能当结论用
  --   probed   [dim]                   已经探到过的维度
  --   unprobed [dim]                   尚未探测的维度 —— 盲区本体，最有信息量
  --   next     [{dim,how}]             下次优先探测方向，让教练从被动响应变主动布局
  dimensions    jsonb not null default '{}'::jsonb,
  -- 攒了多少场。用来判断画像有多少分量：一两场的画像不该被当真。
  sessions_count int not null default 0,
  updated_at    timestamptz not null default now()
);
