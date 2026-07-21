import { getPool } from "@/lib/db";
import { getUserId } from "@/lib/authServer";
import { limitOr429 } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { role: "user" | "assistant"; content: string };

const MAX_MSGS = 400;
const MAX_CHARS = 200_000; // 单个会话 messages 序列化上限

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function cleanMessages(input: unknown): Msg[] {
  if (!Array.isArray(input)) return [];
  const out: Msg[] = [];
  for (const m of input) {
    if (
      m &&
      typeof m === "object" &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string"
    ) {
      out.push({ role: m.role, content: m.content });
    }
    if (out.length >= MAX_MSGS) break;
  }
  return out;
}

function titleFrom(messages: Msg[]): string {
  const first = messages.find((m) => m.role === "user")?.content?.trim();
  if (!first) return "新对话";
  return first.slice(0, 30);
}

// GET            → 列出我的会话（不含 messages，轻）
// GET ?id=uuid   → 取某个会话全文
export async function GET(req: Request) {
  const limited = limitOr429(req, "conv", 120);
  if (limited) return limited;
  const pool = getPool();
  if (!pool) return json({ error: "云端历史未启用" }, 503);
  const uid = await getUserId(req);
  if (!uid) return json({ error: "未登录" }, 401);

  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id) {
      const r = await pool.query(
        "select id, title, messages, updated_at from public.wendao_conversations where id=$1 and user_id=$2",
        [id, uid]
      );
      if (!r.rows.length) return json({ error: "不存在" }, 404);
      return json({ conversation: r.rows[0] });
    }
    const r = await pool.query(
      "select id, title, updated_at from public.wendao_conversations where user_id=$1 order by updated_at desc limit 100",
      [uid]
    );
    return json({ conversations: r.rows });
  } catch (e) {
    console.error("[conversations GET]", e);
    return json({ error: "读取失败" }, 500);
  }
}

// POST {id?, messages, title?} → 新建或更新（作用域=当前用户），返回 {id}
export async function POST(req: Request) {
  const limited = limitOr429(req, "conv", 120);
  if (limited) return limited;
  const pool = getPool();
  if (!pool) return json({ error: "云端历史未启用" }, 503);
  const uid = await getUserId(req);
  if (!uid) return json({ error: "未登录" }, 401);

  let body: { id?: unknown; messages?: unknown; title?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "请求体不合法" }, 400);
  }
  const messages = cleanMessages(body.messages);
  if (!messages.length) return json({ error: "空会话不保存" }, 400);
  const payload = JSON.stringify(messages);
  if (payload.length > MAX_CHARS) return json({ error: "会话过长" }, 413);
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 60)
      : titleFrom(messages);
  const id = typeof body.id === "string" && body.id ? body.id : null;

  try {
    if (id) {
      const r = await pool.query(
        "update public.wendao_conversations set messages=$1::jsonb, title=$2, updated_at=now() where id=$3 and user_id=$4 returning id",
        [payload, title, id, uid]
      );
      if (r.rows.length) return json({ id: r.rows[0].id });
      // id 不属于该用户/不存在 → 当作新建
    }
    const r = await pool.query(
      "insert into public.wendao_conversations (user_id, title, messages) values ($1,$2,$3::jsonb) returning id",
      [uid, title, payload]
    );
    return json({ id: r.rows[0].id });
  } catch (e) {
    console.error("[conversations POST]", e);
    return json({ error: "保存失败" }, 500);
  }
}

// DELETE ?id=uuid
export async function DELETE(req: Request) {
  const limited = limitOr429(req, "conv", 120);
  if (limited) return limited;
  const pool = getPool();
  if (!pool) return json({ error: "云端历史未启用" }, 503);
  const uid = await getUserId(req);
  if (!uid) return json({ error: "未登录" }, 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "缺 id" }, 400);
  try {
    await pool.query(
      "delete from public.wendao_conversations where id=$1 and user_id=$2",
      [id, uid]
    );
    return json({ ok: true });
  } catch (e) {
    console.error("[conversations DELETE]", e);
    return json({ error: "删除失败" }, 500);
  }
}
