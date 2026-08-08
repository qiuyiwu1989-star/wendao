import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "@/lib/persona";
import { limitOr429 } from "@/lib/ratelimit";
import { recallBackground, groundingBlock, canUseDeepbrain } from "@/lib/deepbrain";
import { getUser } from "@/lib/authServer";
import { fetchDueBets, debtBlock } from "@/lib/bets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 统一用 mimo-v2.5：实测首句延迟仅 pro 的一半、解码 3.7x 快，而教练式短回答
// 质量不掉。若哪天想让打字/深度模式换回 pro，改 WENDAO_MODEL 即可。
const MODEL = process.env.WENDAO_MODEL || "mimo-v2.5";
const MODEL_FAST = process.env.WENDAO_MODEL_FAST || "mimo-v2.5";
const MAX_TOKENS = Number(process.env.WENDAO_MAX_TOKENS || 1024);
const LLM_BASE = process.env.LLM_BASE || "https://token-plan-cn.xiaomimimo.com";

type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_TURNS = 40; // 最近 N 条，挡超长历史刷 token
const MAX_CHARS_PER_MSG = 8000;

function sanitize(messages: unknown): IncomingMessage[] {
  if (!Array.isArray(messages)) return [];
  let cleaned: IncomingMessage[] = [];
  for (const m of messages) {
    if (
      m &&
      typeof m === "object" &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0
    ) {
      cleaned.push({ role: m.role, content: m.content.slice(0, MAX_CHARS_PER_MSG) });
    }
  }
  // 只保留最近 MAX_TURNS 条
  if (cleaned.length > MAX_TURNS) cleaned = cleaned.slice(-MAX_TURNS);
  // Anthropic 要求首条为 user
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  // 折叠连续同角色（上游要求严格交替，否则报错）
  const merged: IncomingMessage[] = [];
  for (const m of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content;
    else merged.push({ ...m });
  }
  return merged;
}

export async function POST(req: Request) {
  const limited = limitOr429(req, "chat", 30);
  if (limited) return limited;

  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "服务端未配置 LLM_API_KEY" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体不是合法 JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const messages = sanitize((body as { messages?: unknown })?.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "缺少有效的用户消息" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // fast=true（语音/通话模式）：关掉 MiMo 的"思考"，首句延迟砍掉近一半。
  // 打字/静默模式保留思考，不牺牲难题的锐度。
  const fast = (body as { fast?: unknown })?.fast === true;

  const client = new Anthropic({ apiKey, baseURL: `${LLM_BASE}/anthropic` });
  // 语音模式用精简提示词抢延迟；打字/深度模式用完整版
  let system = buildSystemPrompt(fast ? "voice" : "full");

  // 向下取：拿用户这句话去深脑捞相关判断，让问道问得"懂你"。
  //
  // 安全：服务端只有一把深脑 key（= key 主人自己的大脑），所以**必须**先确认
  // 调用者是已登录的白名单本人，否则任何访客都能读到别人的私有判断。
  // 非白名单用户走纯教练路径（不读深脑），体验照常。
  const caller = await getUser(req);

  // 催账（COUNTERPARTY.md 职能②）：只在**开场那一轮**查一次到期的账，
  // 之后每轮都查是浪费——账已经在上下文里了。取不到就跳过，不拖慢对话。
  if (caller?.id && messages.length <= 2) {
    const due = await fetchDueBets(caller.id, 3);
    if (due.length) system += debtBlock(due);
  }

  if (canUseDeepbrain(caller?.email)) {
    const lastUser = messages[messages.length - 1].content;
    // 语音模式超时更紧——宁可不 grounding 也不能拖慢开口
    const background = await recallBackground(lastUser, fast ? 1800 : 3500);
    if (background) system += groundingBlock(background);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const params: Record<string, unknown> = {
          model: fast ? MODEL_FAST : MODEL,
          max_tokens: MAX_TOKENS,
          // 系统提示词很长且每次相同，MiMo 网关会自动做 prompt cache
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        };
        // MiMo 默认会先"思考"再开口；语音模式显式关闭以抢延迟
        if (fast) params.thinking = { type: "disabled" };
        const anthropicStream = client.messages.stream(
          params as unknown as Parameters<typeof client.messages.stream>[0]
        );

        anthropicStream.on("text", (delta) => {
          controller.enqueue(encoder.encode(delta));
        });

        await anthropicStream.finalMessage();
        controller.close();
      } catch (err) {
        console.error("[chat] upstream error:", err);
        // 只给用户泛化文案，不透传上游细节（可能含内部 URL/网关信息）
        controller.enqueue(encoder.encode(`\n\n[问道这会儿有点忙，稍后再试试]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
