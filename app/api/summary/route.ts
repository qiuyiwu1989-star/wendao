import Anthropic from "@anthropic-ai/sdk";
import { limitOr429 } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.WENDAO_SUMMARY_MODEL || "mimo-v2.5";
const LLM_BASE = process.env.LLM_BASE || "https://token-plan-cn.xiaomimimo.com";

// 提炼「思考小结」：一场对话结束后，把长出来的东西固化成**判断**，而不是聊天摘要。
//
// 为什么是判断形态：深脑本质是判断库（谁认为·什么陈述·依据在哪）。沉淀成判断，
// 用户拿到的是"想清楚的东西"，深脑拿到的是可直接入库的原子——一举两得。
const EXTRACT_PROMPT = `你是「问道」的提炼器。刚刚结束了一场思考教练对话，请从中提炼出**用户想清楚了什么**。

# 铁律
- 提炼的是**用户的判断**，不是问道说过的话。看用户在对话里意识到、承认、决定了什么。
- **只提炼对话里真实出现的东西**。宁可少，不可编。用户没想清楚就不要硬凑。
- 每条判断必须是**具体的、有信息量的一句话**。禁止套话空话——
  ❌"你需要平衡风险与机会" ❌"你要更了解自己" ❌"沟通很重要"
  ✅"你怕的不是创业失败，是要为这个选择负全责"
  ✅"你说团队推不动，但其实是你不肯把判断权交出去"
- 用**第二人称**（你……），像一个认识他的人在复述他自己的话。
- **禁止出现"用户"二字**——那是内部措辞，不是对他说话的方式。
- 不用 Markdown、不用 emoji。

# 判断的三种类型

- \`想清楚了\`：他在这场对话里**真正看明白的**（最有价值）
  **硬标准——满足其一才算，否则降级为「待解」：**
  ① 认知发生转变（"我原以为A，其实是B"）
  ② 他用自己的话下了判断（不是问道下的）
  ③ 承认了之前不肯承认的
  ④ 做了取舍（不是"我再想想"）
  **检验方法：basis 必须是他自己说过的话。如果你只能引用问道说的话，
  说明那是问道的观点、不是他想清楚的——记为「待解」。**

- \`还在赌\`：他的结论**依赖某个尚未验证的假设**。这类必须给 \`checkDays\`：
  多少天内该去验（一般 7-30 天；越关键越短）。

- \`待解\`：明确浮现但还没解决的问题

# 输出
严格输出 JSON，不要任何其他文字、不要代码块围栏：
{
  "title": "6-14字的标题，概括这场想的是什么",
  "judgments": [
    {"type":"想清楚了","text":"一句话判断","basis":"**用户自己说过的**原话片段（十几个字即可）"},
    {"type":"还在赌","text":"他赌的那个假设","basis":"用户原话","checkDays":14}
  ],
  "takeaway": "一句可以带走的话。必须锋利、具体，是这场对话最值得记住的一句。"
}

judgments 给 1-3 条，按价值排序。真的没有值得记的就给空数组。`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function POST(req: Request) {
  const limited = limitOr429(req, "summary", 20);
  if (limited) return limited;

  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "未配置 LLM_API_KEY" }, 500);

  let body: { messages?: unknown };
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

  // 至少两个来回才值得提炼
  if (messages.filter((m) => m.role === "user").length < 2)
    return json({ ok: false, reason: "对话太短" });

  const transcript = messages
    .map((m) => `${m.role === "user" ? "用户" : "问道"}：${m.content}`)
    .join("\n\n")
    .slice(0, 20_000);

  try {
    const client = new Anthropic({ apiKey, baseURL: `${LLM_BASE}/anthropic` });
    const params = {
      model: MODEL,
      max_tokens: 700,
      system: EXTRACT_PROMPT,
      messages: [{ role: "user", content: `对话记录：\n\n${transcript}` }],
      thinking: { type: "disabled" }, // MiMo 扩展参数：关思考抢速度
    };
    const res = (await client.messages.create(
      params as unknown as Parameters<typeof client.messages.create>[0]
    )) as unknown as { content: { type: string; text?: string }[] };

    const text = res.content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("")
      .trim();

    const parsed = parseSummary(text);
    if (!parsed) return json({ ok: false, reason: "提炼失败" });
    return json({ ok: true, summary: parsed });
  } catch (e) {
    console.error("[summary]", e);
    return json({ ok: false, reason: "提炼失败" }, 500);
  }
}

export type Judgment = {
  type: string;
  text: string;
  basis?: string;
  /** 仅「还在赌」：多少天内该去验证 */
  checkDays?: number;
};
export type Summary = {
  title: string;
  judgments: Judgment[];
  takeaway: string;
};

/** 稳健解析：模型可能带代码块围栏或前后废话 */
function parseSummary(text: string): Summary | null {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    const judgments = Array.isArray(o.judgments)
      ? (o.judgments as Record<string, unknown>[])
          .filter((j) => j && typeof j.text === "string" && j.text.trim())
          .slice(0, 3)
          .map((j) => {
            const type = String(j.type || "想清楚了").slice(0, 8);
            const days = Number(j.checkDays);
            return {
              type,
              text: String(j.text).trim().slice(0, 200),
              basis:
                typeof j.basis === "string" && j.basis.trim()
                  ? j.basis.trim().slice(0, 120)
                  : undefined,
              // 只有「还在赌」带期限；没给就默认两周，别让账无限期挂着
              checkDays:
                type === "还在赌"
                  ? Math.min(90, Math.max(3, Number.isFinite(days) ? days : 14))
                  : undefined,
            };
          })
      : [];
    const title = String(o.title || "一次思考").trim().slice(0, 30);
    const takeaway = String(o.takeaway || "").trim().slice(0, 200);
    if (!judgments.length && !takeaway) return null;
    return { title, judgments, takeaway };
  } catch {
    return null;
  }
}
