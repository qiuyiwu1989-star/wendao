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

  async function synth(text: string) {
    if (stopped) return;
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
    if (!ctx) ctx = new Ctor();
    const c = ctx;
    try {
      await c.resume();
    } catch {
      /* 某些浏览器无需 resume */
    }
    if (!started) {
      started = true;
      nextTime = c.currentTime + 0.12;
      opts.onStart?.();
    }

    const reader = res.body.getReader();
    let leftover: Uint8Array | null = null;
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
      if (chunk.done) break;
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
  from: number
): { segments: string[]; next: number } {
  const tail = full.slice(from);
  const re = /[^。！？!?\n]*[。！？!?\n]+/g;
  const segments: string[] = [];
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail))) {
    const seg = m[0].trim();
    if (seg) segments.push(seg);
    consumed = re.lastIndex;
  }
  return { segments, next: from + consumed };
}
