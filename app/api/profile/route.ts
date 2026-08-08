import { getUserId } from "@/lib/authServer";
import { limitOr429 } from "@/lib/ratelimit";
import { fetchProfile, updateProfile, DIMENSIONS } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 思维画像接口（COUNTERPARTY.md 职能③ 照出盲区）。
// 画像是跨会话攒的、只属于本人的东西，所以作用域强制 user_id——
// 一人一行，永远不接受客户端传进来的 user id。

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// GET → 我的画像。还没攒出来时返回 profile: null（不是错误，是"刚开始"）
export async function GET(req: Request) {
  const limited = limitOr429(req, "profile", 60);
  if (limited) return limited;
  const uid = await getUserId(req);
  if (!uid) return json({ error: "未登录" }, 401);

  try {
    const profile = await fetchProfile(uid);
    return json({ profile, dimensions: DIMENSIONS });
  } catch (e) {
    console.error("[profile GET]", e);
    return json({ error: "读取失败" }, 500);
  }
}

// POST {messages:[{role,content}], judgments?:[{type,text,basis}]} → 触发一次增量更新
//
// 为什么限得比读严：每次都要过一遍 LLM 做合并，是这一路上唯一花钱的动作。
export async function POST(req: Request) {
  const limited = limitOr429(req, "profile-update", 10);
  if (limited) return limited;
  const uid = await getUserId(req);
  if (!uid) return json({ error: "未登录" }, 401);

  let body: { messages?: unknown; judgments?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "请求体不合法" }, 400);
  }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages = raw
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        !!m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-40);

  // 一两句话看不出思维方式，硬更新只会往画像里灌噪音
  if (messages.filter((m) => m.role === "user").length < 2)
    return json({ ok: false, reason: "对话太短" });

  const judgments = (Array.isArray(body.judgments) ? body.judgments : [])
    .filter(
      (j): j is { type: string; text: string; basis?: string } =>
        !!j && typeof j === "object" && typeof (j as { text?: unknown }).text === "string"
    )
    .slice(0, 10)
    .map((j) => ({
      type: String(j.type || "").slice(0, 8),
      text: String(j.text).slice(0, 200),
      basis: typeof j.basis === "string" ? j.basis.slice(0, 120) : undefined,
    }));

  const transcript = messages
    .map((m) => `${m.role === "user" ? "用户" : "问道"}：${m.content}`)
    .join("\n\n")
    .slice(0, 20_000);

  try {
    const profile = await updateProfile(uid, judgments, transcript);
    if (!profile) return json({ ok: false, reason: "更新失败" });
    return json({ ok: true, profile });
  } catch (e) {
    console.error("[profile POST]", e);
    return json({ ok: false, reason: "更新失败" }, 500);
  }
}
