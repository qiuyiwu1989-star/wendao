// 深脑（DeepBrain）MCP 客户端 —— 问道的"向下取 / 向上喂"两端。
//
// 向下取，两条路，**对质优先于相关**：
//   1. findTension（对质）：问深脑"我过去有没有说过和这话相反的"。
//   2. recallBackground（相关）：检索与当前话题相关的既有判断。
// 向上喂：一场对话结束，把它投喂回深脑，成为可被分析沉淀的素材。
//
// 为什么对质排第一：深脑存的是用户**已经得出的结论**，光把相关的还给他，
// 只会让他越问越自洽——一个带完整引文的回音室，检索做得越好回路越紧。
// 相关=加固，矛盾=摩擦，而问道的价值在摩擦。所以两者都拿到时，
// tension 块必须拼在 grounding 块**之前**（更靠近模型注意力，先被读到）。
//
// 未配置 DEEPBRAIN_MCP_URL/KEY 时全部静默降级（返回空/不投喂），不影响主流程。

const MCP_URL = process.env.DEEPBRAIN_MCP_URL;
const MCP_KEY = process.env.DEEPBRAIN_MCP_KEY;

export const deepbrainEnabled = !!(MCP_URL && MCP_KEY);

/**
 * 谁能用深脑能力。
 *
 * **安全前提**：服务端只有一把深脑 key，它代表的是「key 主人自己的第二大脑」。
 * 因此深脑能力**绝不能对所有访客开放**——否则任何人都能读到 key 主人的私有判断，
 * 而且陌生人的对话会被投喂进 key 主人的记忆库。
 *
 * 规则：必须是**已登录**、且邮箱在 DEEPBRAIN_OWNER_EMAILS 白名单里的人。
 * 白名单为空 = 深脑能力对所有人关闭（安全默认）。
 */
const OWNERS = (process.env.DEEPBRAIN_OWNER_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function canUseDeepbrain(email: string | null | undefined): boolean {
  if (!deepbrainEnabled) return false;
  if (!email) return false; // 未登录一律不给
  if (OWNERS.length === 0) return false; // 没配白名单=默认关，绝不放开
  return OWNERS.includes(email.trim().toLowerCase());
}

// 检索结果缓存：深脑一次检索 3-4s，同一话题反复问不该反复付这个钱。
// 语音模式常因超时拿不到结果，但后台请求会把结果填进缓存，下一轮就能直接命中。
const cache = new Map<string, { at: number; val: string | null }>();
const CACHE_TTL = 10 * 60_000;

function cacheGet(k: string): string | null | undefined {
  const hit = cache.get(k);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(k);
    return undefined;
  }
  return hit.val;
}

function cacheSet(k: string, val: string | null) {
  if (cache.size > 200) cache.clear();
  cache.set(k, { at: Date.now(), val });
}

type McpResult = { content?: { type: string; text?: string }[] };

async function callTool(
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<string | null> {
  if (!MCP_URL || !MCP_KEY) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MCP_KEY}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      console.error("[deepbrain]", name, res.status);
      return null;
    }
    const j = (await res.json()) as { result?: McpResult; error?: unknown };
    if (j.error) {
      console.error("[deepbrain]", name, "rpc error");
      return null;
    }
    const text = j.result?.content?.find((c) => c.type === "text")?.text;
    return text || null;
  } catch {
    return null; // 超时/网络错：静默降级，绝不拖垮对话
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 向下取：检索与当前话题相关的既有判断。
 * 超时给得紧（默认 2.5s）——grounding 是加分项，不能拖慢开口。
 */
export async function recallBackground(
  query: string,
  timeoutMs = 2500
): Promise<string | null> {
  const q = query.trim().slice(0, 200);
  if (!q || q.length < 4) return null;

  const key = q.toLowerCase();
  const cached = cacheGet(key);
  if (cached !== undefined) return cached; // 命中（含"查过但没结果"）

  // 后台请求：即使本轮等不及，也让它把结果填进缓存，下一轮直接命中
  const pending = callTool("search_brain", { query: q }, 12_000).then((r) => {
    const c = r ? clean(r) : null;
    cacheSet(key, c);
    return c;
  });

  // 硬超时竞速：到点立刻放行继续对话，**不等**在途请求
  // （只靠 AbortController 不够——深脑检索要 3-4s，会把开口拖到十几秒）
  const raw = await Promise.race([
    pending,
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ]);
  return raw;
}

/** 清洗检索结果：去溯源 id、限条数与长度 */
function clean(raw: string): string | null {
  // 去掉溯源 id（<analysis:...>）——那是给机器的，塞进提示词只会干扰模型
  const cleaned = raw
    .replace(/<analysis:[^>]*>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6) // 最多 6 条，别把提示词撑爆
    .join("\n");
  return cleaned.length > 20 ? cleaned.slice(0, 1800) : null;
}

/** 把 grounding 结果包装成系统提示词片段 */
export function groundingBlock(background: string): string {
  return `

---

# 你对这个人的既有了解（来自深脑，仅供你参考）

下面是这位用户过去沉淀下来的相关判断/信号。**这不是他刚说的话**，是他以前的思考：

${background}

用法（重要）：
- 让它帮你问出"懂他"的问题——比如发现他以前有过相关判断、或跟现在的说法有出入，可以点出来。
- **不要复述它、不要显摆你知道**，更不要说"根据你的记录/深脑显示"。像一个认识他很久的人那样自然地用。
- 如果跟当前话题没关系，直接忽略。`;
}

/**
 * 对质：拿用户这句话去问深脑「我过去有没有说过与此相反的判断」。
 *
 * 和 recallBackground 的区别不在实现、在**问法**：search_brain 找的是相关，
 * ask_brain 能做跨篇比对（它官方举的例子就是"我们在定价上有没有自相矛盾"）。
 * 拿不到 / 超时 / 深脑说没有 → 一律 null，对质是加分项，绝不拖垮对话。
 */
export async function findTension(
  userSaid: string,
  timeoutMs = 2500
): Promise<string | null> {
  const q = userSaid.trim().slice(0, 200);
  if (!q || q.length < 4) return null;

  // 另起 key 前缀：同一句话的"找相关"和"找矛盾"是两个答案，别互相覆盖
  const key = `tension:${q.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached; // 命中（含"问过但没矛盾"）

  const question =
    `我刚才说："${q}"。` +
    `关于这件事，我过去有没有说过与此不一致、或者相反的判断？` +
    `如果有，把我的原话和当时的语境说出来，并指出不一致在哪；` +
    `如果没有，就只回答"没有"，不要为了凑答案硬找。`;

  // ask_brain 要做跨篇推理，比 search_brain 更慢，后台超时放宽到 20s：
  // 本轮多半等不到，但结果会落进缓存，用户接着往下说的那轮就能直接命中
  const pending = callTool("ask_brain", { question }, 20_000).then((r) => {
    const c = r ? cleanTension(r) : null;
    cacheSet(key, c);
    return c;
  });

  // 同 recallBackground：硬超时竞速，到点立刻放行，不等在途请求
  return await Promise.race([
    pending,
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ]);
}

/**
 * 清洗对质结果，并把"没有矛盾"识别成 null。
 *
 * 宁可漏判也不能错判：识别错了会让问道拿着一句"没有找到"去质问用户。
 * 所以只在**短且以否定开头**时判为没有——长答案里的"没有"多半是原话的一部分。
 */
function cleanTension(raw: string): string | null {
  const cleaned = raw
    .replace(/<analysis:[^>]*>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  if (cleaned.length < 20) return null;

  const head = cleaned.slice(0, 40);
  if (/^(没有|无|未发现|找不到|不存在|没找到|暂无)/.test(head)) return null;
  // 短答案 + 明确否定 = 深脑在说"查过了，不矛盾"
  if (cleaned.length < 120 && /(没有|未发现|找不到|不存在|不矛盾|一致的)/.test(cleaned))
    return null;

  return cleaned.slice(0, 1400);
}

/**
 * 把对质结果包装成系统提示词片段。
 * 注意拼装顺序：这一块要放在 groundingBlock **之前**（见文件头）。
 */
export function tensionBlock(text: string): string {
  return `

---

# 他过去说过的、可能和现在不一致的话（来自深脑）

${text}

用法（重要）：
- 这不是背景资料，是**摩擦**。把两个版本摆到一起，让他自己看见：
  "你三个月前说这个团队最大的问题是人不对，今天你说是机制——中间发生了什么，还是换了个更舒服的解释？"
- 摆出来就行，不替他下结论。他改口可能有充分理由，也可能只是找了个更好受的说法，让他自己说。
- **绝不要说"系统显示""根据记录""深脑里查到"**。像个记性好的朋友，随口就能想起他当时怎么说的。
- 如果读下来其实并不矛盾，直接忽略这一块，**别硬造对立**——硬造出来的对质比不对质更伤信任。
- 语音场景下要短：一句话点出出入，再问一句，不要长篇罗列。`;
}

/**
 * 向上喂：把一场对话投喂回深脑，成为可被分析沉淀的素材。
 * 后台跑，不阻塞用户。
 */
export async function feedConversation(
  messages: { role: "user" | "assistant"; content: string }[],
  title?: string
): Promise<boolean> {
  if (!deepbrainEnabled) return false;
  const body = messages
    .map((m) => `${m.role === "user" ? "用户" : "问道"}：${m.content}`)
    .join("\n\n");
  // 深脑要求正文 ≥100 字；这里留出余量，太短的对话本也没沉淀价值
  if (body.length < 160) return false;
  const first = messages.find((m) => m.role === "user")?.content || "";
  const t = (title || `问道对话 · ${first.slice(0, 20)}`).slice(0, 60);
  const r = await callTool(
    "ingest_transcript",
    { text: body.slice(0, 50_000), title: t },
    15_000
  );
  return !!r;
}
