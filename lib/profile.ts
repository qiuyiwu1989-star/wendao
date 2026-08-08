import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "@/lib/db";

// 思维画像（COUNTERPARTY.md 职能③ 照出盲区）：跨会话攒下来的「这个人怎么想事情」。
//
// 为什么必须跨会话：单场对话只看得见他说了什么，看不见他**从来不说什么**。
// 沉默才是盲区所在——反复绕开的话题、从来不问的那类问题、每次都跳过的那一步。
// 所以这里最值钱的不是"强信号"那几条结论，而是 unprobed（还没探过的维度）
// 和 next（下次该往哪儿探）：它让问道从被动响应变成主动布局。

const MODEL = process.env.WENDAO_SUMMARY_MODEL || "mimo-v2.5";
const LLM_BASE = process.env.LLM_BASE || "https://token-plan-cn.xiaomimimo.com";

/** 成人思考场景的六个维度。固定一张表，才能算得出"哪个还没探过" */
export const DIMENSIONS = [
  "决策风格",
  "风险偏好",
  "时间视野",
  "归因倾向",
  "元认知",
  "情绪处理",
] as const;

export type StrongSignal = { dim: string; claim: string; evidence: string };
export type WeakSignal = { dim: string; claim: string; hint: string };
export type NextProbe = { dim: string; how: string };

export type ProfileDimensions = {
  /** 强信号：有对话原话作证的 */
  strong: StrongSignal[];
  /** 弱信号：像是这样但没坐实——不能当结论用，只能当"可以去验的方向" */
  weak: WeakSignal[];
  /** 已探测过的维度 */
  probed: string[];
  /** 尚未探测的维度——盲区本体 */
  unprobed: string[];
  /** 下次优先探测方向 */
  next: NextProbe[];
};

export type Profile = {
  dimensions: ProfileDimensions;
  sessionsCount: number;
  updatedAt: string;
};

const EMPTY: ProfileDimensions = {
  strong: [],
  weak: [],
  probed: [],
  unprobed: [...DIMENSIONS],
  next: [],
};

/** 取该用户的画像；从没建过就返回 null（调用方据此走"没有画像"的路径） */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const r = await pool.query(
      `select dimensions, sessions_count, updated_at
         from public.wendao_profile
        where user_id = $1`,
      [userId]
    );
    if (!r.rows.length) return null;
    const row = r.rows[0] as {
      dimensions: unknown;
      sessions_count: number;
      updated_at: Date;
    };
    return {
      dimensions: normalize(row.dimensions),
      sessionsCount: Number(row.sessions_count) || 0,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  } catch (e) {
    console.error("[profile] fetch", e);
    return null; // 画像是加分项，取不到就算了，绝不拖垮对话
  }
}

const MERGE_PROMPT = `你是「问道」的画像师。问道是一个思考教练，它需要长期记住**这个人是怎么想事情的**，
尤其是他**从来不碰的那些维度**——因为沉默比内容更有信息。

现在给你：这个人已有的画像（可能为空）+ 刚结束的一场对话。请把新证据**并进**旧画像。

# 六个维度（只用这些名字，不要自创）
- 决策风格：怎么做决定（要齐全信息还是先动起来、听谁的、卡在哪一步）
- 风险偏好：面对下行怎么反应（回避、对冲、押注、装作看不见）
- 时间视野：想事情看多远（这周、这季度、五年）
- 归因倾向：出事了怪外部还是反求诸己
- 元认知：会不会怀疑自己（"我可能想错了"这种话说不说得出口）
- 情绪处理：情绪来了怎么办（讲出来、绕开、合理化成"客观分析"）

# 铁律
- **宁可少，不可编**。这场对话没碰到的维度，就是没碰到——不许推测，不许凑满。
- 严格区分：
  - 强信号：他**自己说过的原话**能作证。evidence 必须是他的原话片段，不是你的转述。
  - 弱信号：只是苗头、只出现过一次、或者是从他的语气/回避方式里读出来的。没有原话就只能进弱信号。
  - **拿不准就放弱信号，或者不放。**
- 合并规则：
  - 旧画像的条目**默认保留**。只有新证据明确推翻它时才改写，并在 claim 里体现变化。
  - 弱信号被新的原话坐实了 → 升成强信号，补上 evidence。
  - 同一维度的重复表述合并成一条，别堆同义句。
- probed 只填**这次或以前真的探到过**的维度名。
- next 是给下一场对话的布局：挑 1-2 个还没探过、且**跟他关心的事有关**的维度，
  写一句"可以顺着什么话头去问"。不要写成审问提纲。
- 全部用第二人称之外的客观陈述句（"做决定前要把信息拿齐才敢动"），不要出现"用户"二字。
- 不用 Markdown、不用 emoji。

# 输出
严格输出 JSON，不要任何其他文字、不要代码块围栏：
{
  "strong": [{"dim":"风险偏好","claim":"一句话说清他在这个维度上什么样","evidence":"他的原话片段"}],
  "weak":   [{"dim":"元认知","claim":"倾向性描述","hint":"凭什么这么觉得（一句）"}],
  "probed": ["决策风格","风险偏好"],
  "next":   [{"dim":"时间视野","how":"他这次一直在说下个月，可以顺势问他三年后这件事还成不成立"}]
}

strong 最多 8 条，weak 最多 6 条，next 最多 2 条。没有就给空数组。`;

/**
 * 增量更新画像：把这一场的新证据并进旧画像。
 * 失败返回 null（画像更新永远不该影响主流程）。
 */
export async function updateProfile(
  userId: string,
  summaryJudgments: { type: string; text: string; basis?: string }[],
  transcript: string
): Promise<Profile | null> {
  const pool = getPool();
  if (!pool) return null;
  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prev = await fetchProfile(userId);
  const old = prev?.dimensions ?? EMPTY;

  // 判断（小结提炼出来的）比逐字稿密度高得多，放前面；逐字稿给语气和回避方式作补充。
  const judgeText = summaryJudgments
    .filter((j) => j && typeof j.text === "string" && j.text.trim())
    .slice(0, 10)
    .map((j) => `- [${j.type}] ${j.text}${j.basis ? `（原话："${j.basis}"）` : ""}`)
    .join("\n");

  const input = `# 已有画像（JSON）
${JSON.stringify(
  { strong: old.strong, weak: old.weak, probed: old.probed },
  null,
  0
)}

# 这一场提炼出的判断
${judgeText || "（无）"}

# 这一场的对话记录
${transcript.slice(0, 16_000) || "（无）"}`;

  let merged: ProfileDimensions;
  try {
    const client = new Anthropic({ apiKey, baseURL: `${LLM_BASE}/anthropic` });
    const params = {
      model: MODEL,
      max_tokens: 1400,
      system: MERGE_PROMPT,
      messages: [{ role: "user", content: input }],
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

    const parsed = parseDimensions(text);
    if (!parsed) return null;
    merged = parsed;
  } catch (e) {
    console.error("[profile] merge", e);
    return null;
  }

  try {
    const r = await pool.query(
      `insert into public.wendao_profile (user_id, dimensions, sessions_count, updated_at)
       values ($1, $2::jsonb, 1, now())
       on conflict (user_id) do update
          set dimensions = excluded.dimensions,
              sessions_count = public.wendao_profile.sessions_count + 1,
              updated_at = now()
       returning dimensions, sessions_count, updated_at`,
      [userId, JSON.stringify(merged)]
    );
    const row = r.rows[0] as {
      dimensions: unknown;
      sessions_count: number;
      updated_at: Date;
    };
    return {
      dimensions: normalize(row.dimensions),
      sessionsCount: Number(row.sessions_count) || 0,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  } catch (e) {
    console.error("[profile] upsert", e);
    return null;
  }
}

/** 稳健解析：模型可能带代码块围栏或前后废话（同 summary 路由的做法） */
function parseDimensions(text: string): ProfileDimensions | null {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return normalize(JSON.parse(s.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * 归一化：模型和历史数据都可能少字段、给野维度名。
 * unprobed 一律由服务端从 DIMENSIONS 反推——这是"盲区"的定义所在，
 * 不能让模型自己报，它会漏报（漏报=盲区看不见，正好是我们要防的）。
 */
function normalize(raw: unknown): ProfileDimensions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const canonical = (v: unknown) => {
    const d = str(v, 12);
    return (DIMENSIONS as readonly string[]).includes(d) ? d : "";
  };

  const strong: StrongSignal[] = arr(o.strong)
    .map((x) => ({
      dim: str(x?.dim, 12),
      claim: str(x?.claim, 160),
      evidence: str(x?.evidence, 120),
    }))
    .filter((x) => x.dim && x.claim)
    .slice(0, 8);

  const weak: WeakSignal[] = arr(o.weak)
    .map((x) => ({
      dim: str(x?.dim, 12),
      claim: str(x?.claim, 160),
      hint: str(x?.hint, 120),
    }))
    .filter((x) => x.dim && x.claim)
    .slice(0, 6);

  // probed 取并集：模型报的 + 强信号里实际出现的维度（有证据就一定是探过了）
  const probedSet = new Set<string>();
  for (const v of Array.isArray(o.probed) ? o.probed : []) {
    const d = canonical(v);
    if (d) probedSet.add(d);
  }
  for (const s of strong) {
    const d = canonical(s.dim);
    if (d) probedSet.add(d);
  }
  const probed = DIMENSIONS.filter((d) => probedSet.has(d));
  const unprobed = DIMENSIONS.filter((d) => !probedSet.has(d));

  const next: NextProbe[] = arr(o.next)
    .map((x) => ({ dim: str(x?.dim, 12), how: str(x?.how, 160) }))
    .filter((x) => x.dim && x.how)
    .slice(0, 2);

  return { strong, weak, probed, unprobed, next };
}

/**
 * 拼成提示词片段：告诉问道这个人怎么想事情、哪个维度从没被探过、这轮可以顺势探哪个。
 * 没什么可说的（画像还是空的）就返回空串，别往上下文里塞废话。
 */
export function profileBlock(profile: Profile | null): string {
  if (!profile) return "";
  const { strong, weak, unprobed, next } = profile.dimensions;
  if (!strong.length && !weak.length && !next.length) return "";

  const parts: string[] = [];

  if (strong.length) {
    parts.push(
      `## 已经看准的（他自己的话作证，可以直接用）
${strong
  .map((s) => `- ${s.dim}：${s.claim}${s.evidence ? `　原话："${s.evidence}"` : ""}`)
  .join("\n")}`
    );
  }

  if (weak.length) {
    parts.push(
      `## 只是苗头（**没坐实，不许当结论说出口**，只能当"值得去验的方向"）
${weak.map((w) => `- ${w.dim}：${w.claim}`).join("\n")}`
    );
  }

  if (unprobed.length) {
    parts.push(
      `## 从来没探过的维度（这才是盲区）
${unprobed.join("、")}

聊了 ${profile.sessionsCount} 场，这些维度一次都没露过面。
可能是碰巧没聊到，也可能是**他在绕开**——后者更值得留意。`
    );
  }

  if (next.length) {
    parts.push(
      `## 这轮可以顺势探的
${next.map((n) => `- ${n.dim}：${n.how}`).join("\n")}`
    );
  }

  return `

---

# 关于这个人怎么想事情（跨会话攒的，仅供你使用）

${parts.join("\n\n")}

**怎么用：**
- **绝不复述画像本身**。不说"根据你的画像""你是一个 X 型的人""我注意到你一贯……"——
  被人当面念档案是最败兴的事，而且会让他开始表演成档案里的样子。
- 画像只影响你**问什么**，不影响你**说什么**。用它选问题的角度，不用它下结论。
- 探测要顺势：等他自己聊到附近了再往那边带一句。**不合适就完全忽略这一段**，
  硬把话题拐过去比不探更糟。
- 一轮最多探一个维度，别做问卷。
- 弱信号只能用来问，不能用来判。`;
}
