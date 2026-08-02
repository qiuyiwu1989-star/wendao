import { getPool } from "@/lib/db";
import { getUserId } from "@/lib/authServer";
import { limitOr429 } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 思考小结的云端存档。
//
// 设计要点：小结存在**问道自己的表**里、按 user_id 隔离，而不是用一把 MCP key
// 往深脑写。因为两边是同一套账号（深脑 Supabase），深脑侧可以用同一个 user_id
// 直接读这张表，把用户在问道攒下的判断接进去——既是无缝承接，也不存在
// "拿别人的 key 写进别人大脑"的风险。

type Judgment = { type: string; text: string; basis?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function cleanJudgments(input: unknown): Judgment[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (j): j is Record<string, unknown> =>
        !!j && typeof j === "object" && typeof (j as { text?: unknown }).text === "string"
    )
    .slice(0, 5)
    .map((j) => ({
      type: String(j.type || "想清楚了").slice(0, 8),
      text: String(j.text).slice(0, 300),
      basis: typeof j.basis === "string" ? j.basis.slice(0, 200) : undefined,
    }));
}

// GET → 我的小结列表
export async function GET(req: Request) {
  const limited = limitOr429(req, "sum", 120);
  if (limited) return limited;
  const pool = getPool();
  if (!pool) return json({ error: "云端未启用" }, 503);
  const uid = await getUserId(req);
  if (!uid) return json({ error: "未登录" }, 401);
  try {
    const r = await pool.query(
      "select id, title, judgments, takeaway, created_at from public.wendao_summaries where user_id=$1 order by created_at desc limit 200",
      [uid]
    );
    return json({ summaries: r.rows });
  } catch (e) {
    console.error("[summaries GET]", e);
    return json({ error: "读取失败" }, 500);
  }
}

// POST {items:[{title,judgments,takeaway,local_id}]} → 批量上传（幂等，按 local_id 去重）
export async function POST(req: Request) {
  const limited = limitOr429(req, "sum", 120);
  if (limited) return limited;
  const pool = getPool();
  if (!pool) return json({ error: "云端未启用" }, 503);
  const uid = await getUserId(req);
  if (!uid) return json({ error: "未登录" }, 401);

  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "请求体不合法" }, 400);
  }
  const raw = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
  if (!raw.length) return json({ synced: 0 });

  let synced = 0;
  try {
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const judgments = cleanJudgments(o.judgments);
      const takeaway = typeof o.takeaway === "string" ? o.takeaway.slice(0, 300) : "";
      if (!judgments.length && !takeaway) continue;
      const title = typeof o.title === "string" ? o.title.slice(0, 60) : "";
      const localId =
        typeof o.local_id === "string" ? o.local_id.slice(0, 64) : null;
      const r = await pool.query(
        `insert into public.wendao_summaries (user_id, title, judgments, takeaway, local_id)
         values ($1,$2,$3::jsonb,$4,$5)
         on conflict (user_id, local_id) where local_id is not null do nothing
         returning id`,
        [uid, title, JSON.stringify(judgments), takeaway, localId]
      );
      if (r.rows.length) synced++;
    }
    return json({ synced });
  } catch (e) {
    console.error("[summaries POST]", e);
    return json({ error: "同步失败" }, 500);
  }
}
