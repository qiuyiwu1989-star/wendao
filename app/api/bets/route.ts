import { getPool } from "@/lib/db";
import { getUserId } from "@/lib/authServer";
import { limitOr429 } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 账本接口：那些「还在赌」的假设。
// 见 COUNTERPARTY.md 职能② 催账——判断有保质期，说过要验的到期要被翻出来问。
// 不催账的账本没有意义，所以这里的核心是 due_at 和 status。

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// GET            → 挂着的账（按到期日升序，最该问的在前）+ 各状态计数
// GET ?due=1     → 只要已到期的
//
// stats 里最重要的是 broken（验了不成立）：
// COUNTERPARTY.md 第四节说，问道成功的唯一标准是"用户有没有因为它改掉过一个判断"。
// broken 就是那个数。它必须能被看见，否则唯一标准会被"体验顺不顺"这类指标带偏。
export async function GET(req: Request) {
  const limited = limitOr429(req, "bets", 120);
  if (limited) return limited;
  const pool = getPool();
  if (!pool) return json({ error: "云端未启用" }, 503);
  const uid = await getUserId(req);
  if (!uid) return json({ error: "未登录" }, 401);

  const onlyDue = new URL(req.url).searchParams.get("due") === "1";
  try {
    const r = await pool.query(
      `select id, claim, basis, from_title, due_at, created_at,
              (due_at <= now()) as overdue
         from public.wendao_bets
        where user_id = $1 and status = 'open'
          ${onlyDue ? "and due_at <= now()" : ""}
        order by due_at asc
        limit 50`,
      [uid]
    );
    // 计数走独立的 group by：列表被 status='open' 和 limit 50 框住了，数不出全量。
    // 同样强制 user_id 作用域——统计也是用户数据，不许跨用户看。
    const s = await pool.query<{ status: string; n: string }>(
      `select status, count(*)::text as n
         from public.wendao_bets
        where user_id = $1
        group by status`,
      [uid]
    );
    const stats = { open: 0, held: 0, broken: 0, dropped: 0 };
    for (const row of s.rows) {
      if (row.status in stats) stats[row.status as keyof typeof stats] = Number(row.n) || 0;
    }
    return json({ bets: r.rows, stats });
  } catch (e) {
    console.error("[bets GET]", e);
    return json({ error: "读取失败" }, 500);
  }
}

// POST {items:[{claim,basis,checkDays,fromTitle,local_id}]} → 记账（幂等）
export async function POST(req: Request) {
  const limited = limitOr429(req, "bets", 120);
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
  const raw = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  let added = 0;
  try {
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const claim = typeof o.claim === "string" ? o.claim.trim().slice(0, 300) : "";
      if (!claim) continue;
      const days = Number(o.checkDays);
      const checkDays = Math.min(90, Math.max(3, Number.isFinite(days) ? days : 14));
      const r = await pool.query(
        `insert into public.wendao_bets (user_id, claim, basis, from_title, due_at, local_id)
         values ($1,$2,$3,$4, now() + ($5 || ' days')::interval, $6)
         on conflict (user_id, local_id) where local_id is not null do nothing
         returning id`,
        [
          uid,
          claim,
          typeof o.basis === "string" ? o.basis.slice(0, 200) : "",
          typeof o.fromTitle === "string" ? o.fromTitle.slice(0, 60) : "",
          String(checkDays),
          typeof o.local_id === "string" ? o.local_id.slice(0, 64) : null,
        ]
      );
      if (r.rows.length) added++;
    }
    return json({ added });
  } catch (e) {
    console.error("[bets POST]", e);
    return json({ error: "记账失败" }, 500);
  }
}

// PATCH {id, status, note?} → 结账：held(成立) / broken(不成立) / dropped(不验了)
export async function PATCH(req: Request) {
  const limited = limitOr429(req, "bets", 120);
  if (limited) return limited;
  const pool = getPool();
  if (!pool) return json({ error: "云端未启用" }, 503);
  const uid = await getUserId(req);
  if (!uid) return json({ error: "未登录" }, 401);

  let body: { id?: unknown; status?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "请求体不合法" }, 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  const status = String(body.status || "");
  if (!id || !["held", "broken", "dropped"].includes(status))
    return json({ error: "参数不合法" }, 400);

  try {
    const r = await pool.query(
      `update public.wendao_bets
          set status = $1, settled_at = now(), note = $2
        where id = $3 and user_id = $4
        returning id, status`,
      [status, typeof body.note === "string" ? body.note.slice(0, 300) : "", id, uid]
    );
    if (!r.rows.length) return json({ error: "不存在" }, 404);
    return json({ ok: true, ...r.rows[0] });
  } catch (e) {
    console.error("[bets PATCH]", e);
    return json({ error: "结账失败" }, 500);
  }
}
