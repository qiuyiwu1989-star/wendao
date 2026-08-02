import { feedConversation, deepbrainEnabled } from "@/lib/deepbrain";
import { limitOr429 } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// 向上喂：把一场对话投喂回深脑，成为可被分析沉淀的素材。
// 前端在"结束通话/新建对话/离开"时调用，成败都不影响用户。
export async function POST(req: Request) {
  const limited = limitOr429(req, "feed", 20);
  if (limited) return limited;
  if (!deepbrainEnabled)
    return new Response(JSON.stringify({ ok: false, reason: "未接深脑" }), {
      headers: { "content-type": "application/json" },
    });

  let body: { messages?: unknown; title?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体不合法" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
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
    .slice(-60);

  if (messages.length < 2)
    return new Response(JSON.stringify({ ok: false, reason: "太短" }), {
      headers: { "content-type": "application/json" },
    });

  const title = typeof body.title === "string" ? body.title : undefined;
  const ok = await feedConversation(messages, title);
  return new Response(JSON.stringify({ ok }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
