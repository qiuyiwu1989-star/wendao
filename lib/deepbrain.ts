// 深脑（DeepBrain）MCP 客户端 —— 问道的"向下取 / 向上喂"两端。
//
// 向下取 grounding：对话前用用户这句话去深脑检索相关判断，塞进提示词，
//   于是问道问出的是"懂你的"问题，而不是在真空里空谈。
// 向上喂：一场对话结束，把它投喂回深脑，成为可被分析沉淀的素材。
//
// 未配置 DEEPBRAIN_MCP_URL/KEY 时全部静默降级（返回空/不投喂），不影响主流程。

const MCP_URL = process.env.DEEPBRAIN_MCP_URL;
const MCP_KEY = process.env.DEEPBRAIN_MCP_KEY;

export const deepbrainEnabled = !!(MCP_URL && MCP_KEY);

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
  if (body.length < 120) return false; // 太短没有沉淀价值
  const first = messages.find((m) => m.role === "user")?.content || "";
  const t = (title || `问道对话 · ${first.slice(0, 20)}`).slice(0, 60);
  const r = await callTool(
    "ingest_transcript",
    { text: body.slice(0, 50_000), title: t },
    15_000
  );
  return !!r;
}
