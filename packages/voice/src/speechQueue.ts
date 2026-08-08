// 句级流式语音队列：一句一句地合成+播放，无缝拼接。
// 关键收益：模型吐出第一句就开读，不等整段生成完；后面句子的合成
// 与前面句子的播放重叠。所有段共用一个 AudioContext 和 nextTime 游标，
// 因此段与段之间衔接顺滑。

export type SpeechQueue = {
  push: (text: string) => void; // 追加一段待读文本（一句/一小节）
  end: () => void; // 声明不再有新文本，播完触发 onDrain
  stop: () => void; // 立即停止并释放
};

type AudioCtor = typeof AudioContext;

export function speechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
    )
  );
}

/**
 * 合成结果缓存：同一段文字用同一音色重听时，不再请求 TTS。
 * 存的是解码后的 Float32 PCM（可直接建 AudioBuffer）。
 * 只留最近 12 条、每条 ≤ 60 秒音频，避免内存无限涨。
 */
type CachedAudio = { pcm: Float32Array<ArrayBuffer>; rate: number };
const audioCache = new Map<string, CachedAudio>();
const CACHE_MAX = 12;
const CACHE_MAX_SAMPLES = 24000 * 60;

function cacheKey(text: string, voice?: string) {
  return `${voice || ""}\u0000${text}`;
}

function cacheGet(k: string): CachedAudio | undefined {
  const hit = audioCache.get(k);
  if (hit) {
    audioCache.delete(k); // LRU：命中即刷新
    audioCache.set(k, hit);
  }
  return hit;
}

function cachePut(k: string, v: CachedAudio) {
  if (v.pcm.length > CACHE_MAX_SAMPLES) return; // 太长不缓存
  audioCache.set(k, v);
  while (audioCache.size > CACHE_MAX) {
    const oldest = audioCache.keys().next().value;
    if (oldest === undefined) break;
    audioCache.delete(oldest);
  }
}

/** 清空合成缓存（换音色等场景可主动调用；正常不需要） */
export function clearSpeechCache() {
  audioCache.clear();
}

export function createSpeechQueue(opts: {
  url: string;
  voice?: string;
  onStart?: () => void; // 第一声真正播出时
  onDrain?: () => void; // 全部播完（自然结束）时
}): SpeechQueue {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;

  let ctx: AudioContext | null = null;
  let nextTime = 0;
  let started = false;
  let stopped = false;
  let ended = false;
  let pending = 0;
  let chain: Promise<void> = Promise.resolve();
  const sources: AudioBufferSourceNode[] = [];
  const controllers: AbortController[] = [];

  function cleanup() {
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
  }

  function maybeDrain() {
    if (!ended || pending > 0 || stopped) return;
    const c = ctx;
    const waitMs = c ? Math.max(0, (nextTime - c.currentTime) * 1000) + 90 : 0;
    setTimeout(() => {
      if (stopped) return;
      opts.onDrain?.();
      cleanup();
    }, waitMs);
  }

  /** 把一段 PCM 排进播放时间轴（缓存命中和流式收流共用） */
  function schedule(f32: Float32Array<ArrayBuffer>, rate: number) {
    const c = ctx;
    if (!c || stopped || f32.length === 0) return;
    const buf = c.createBuffer(1, f32.length, rate);
    buf.copyToChannel(f32, 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    const at = Math.max(nextTime, c.currentTime + 0.02);
    src.start(at);
    nextTime = at + buf.duration;
    sources.push(src);
  }

  /** 起播前的通用准备：建 ctx、对齐时间游标、触发 onStart */
  async function ensureStarted(): Promise<AudioContext | null> {
    if (!ctx) ctx = new Ctor();
    const c = ctx;
    try {
      await c.resume();
    } catch {
      /* 某些浏览器无需 resume */
    }
    if (stopped) return null;
    if (!started) {
      started = true;
      nextTime = c.currentTime + 0.12;
      opts.onStart?.();
    }
    return c;
  }

  async function synth(text: string) {
    if (stopped) return;

    // 缓存命中：重听同一段不再花钱合成
    const key = cacheKey(text, opts.voice);
    const hit = cacheGet(key);
    if (hit) {
      if (!(await ensureStarted())) return;
      schedule(hit.pcm, hit.rate);
      return;
    }

    const ac = new AbortController();
    controllers.push(ac);

    let res: Response;
    try {
      res = await fetch(opts.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts.voice ? { text, voice: opts.voice } : { text }),
        signal: ac.signal,
      });
    } catch {
      return;
    }
    if (stopped || !res.ok || !res.body) return;

    const rate = Number(res.headers.get("x-sample-rate")) || 24000;
    if (!(await ensureStarted())) return;

    const reader = res.body.getReader();
    let leftover: Uint8Array | null = null;
    const collected: Float32Array<ArrayBuffer>[] = []; // 收全了存进缓存，供重听复用
    let complete = false;
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        break;
      }
      if (stopped) {
        reader.cancel().catch(() => {});
        break;
      }
      if (chunk.done) {
        complete = true;
        break;
      }
      let bytes = chunk.value;
      if (!bytes || bytes.length === 0) continue;
      if (leftover) {
        const merged = new Uint8Array(leftover.length + bytes.length);
        merged.set(leftover);
        merged.set(bytes, leftover.length);
        bytes = merged;
        leftover = null;
      }
      const usable = bytes.length - (bytes.length % 2);
      if (usable < bytes.length) leftover = bytes.slice(usable);
      if (usable === 0) continue;

      const slice = bytes.slice(0, usable);
      const int16 = new Int16Array(slice.buffer, 0, usable / 2);
      const f32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;

      collected.push(f32);
      schedule(f32, rate);
    }

    // 完整收到才入缓存（中途被打断的是残段，缓存了会放出半句）
    if (complete && !stopped && collected.length) {
      let n = 0;
      for (const c of collected) n += c.length;
      const all = new Float32Array(n);
      let o = 0;
      for (const c of collected) {
        all.set(c, o);
        o += c.length;
      }
      cachePut(key, { pcm: all, rate });
    }
  }

  return {
    push(text: string) {
      const t = text.trim();
      if (!t || stopped) return;
      pending++;
      chain = chain
        .then(() => synth(t))
        .catch(() => {})
        .then(() => {
          pending--;
          maybeDrain();
        });
    },
    end() {
      ended = true;
      maybeDrain();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const a of controllers) {
        try {
          a.abort();
        } catch {
          /* ignore */
        }
      }
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* ignore */
        }
      }
      cleanup();
    },
  };
}

/**
 * 从流式文本里切出「已完成的整句」。返回新整句数组 + 新的已消费长度。
 * 句界：。！？!? 或换行。未闭合的尾巴留到下次。
 */
export function takeSentences(
  full: string,
  from: number,
  opts?: { firstChunkFast?: boolean }
): { segments: string[]; next: number } {
  const tail = full.slice(from);
  const segments: string[] = [];
  let consumed = 0;

  // 抢首声：**第一块**允许在逗号/顿号/分号处就切出去朗读。
  // 语音是边生成边读的，等一整句才开口会白等 1-2 秒（实测首句 43 字时多等 2s）。
  // 只对第一块这么做——后面的块已经在播放中，按整句切更自然。
  if (opts?.firstChunkFast && from === 0) {
    const m = /^[^。！？!?\n]*?[，、；,;]/.exec(tail);
    if (m && m[0].trim().length >= 6) {
      const seg = m[0].replace(/[，、；,;]\s*$/, "").trim();
      if (seg) {
        segments.push(seg);
        consumed = m[0].length;
      }
    }
  }

  const re = /[^。！？!?\n]*[。！？!?\n]+/g;
  re.lastIndex = consumed;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail))) {
    const seg = m[0].trim();
    if (seg) segments.push(seg);
    consumed = re.lastIndex;
  }
  return { segments, next: from + consumed };
}
