// 麦克风采集 + 静音检测（VAD）+ WAV 编码。
// 用它取代浏览器 Web Speech API（谷歌后端，国内被墙）：录一段音频，
// 说完（静音一小段）自动收尾，编码成 wav 交给 /api/asr 走 MiMo 转写。

export type VoiceCapture = {
  stop: () => void; // 手动收尾：立即编码并回调 onResult
  cancel: () => void; // 丢弃并释放
};

type AudioCtor = typeof AudioContext;

export function recorderSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" &&
    !!(
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
    )
  );
}

export async function startVoiceCapture(opts: {
  onResult: (wav: Blob) => void;
  onNoSpeech?: () => void;
  onError?: (e: unknown) => void;
  silenceMs?: number; // 语音后静音多久算说完
  maxMs?: number; // 单段最长
  noSpeechMs?: number; // 一直没说话多久放弃
}): Promise<VoiceCapture> {
  const silenceMs = opts.silenceMs ?? 900;
  const maxMs = opts.maxMs ?? 20000;
  const noSpeechMs = opts.noSpeechMs ?? 9000;

  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    opts.onError?.(e);
    return { stop: () => {}, cancel: () => {} };
  }

  const ctx = new Ctor();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0; // 接到 destination 只为让 onaudioprocess 触发，不外放（防回声）
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  const rate = ctx.sampleRate;
  const chunks: Float32Array[] = [];
  let done = false;
  const t0 = performance.now();
  let lastVoice = 0;
  let speechStarted = false;
  let noiseFloor = 0.004;
  let calibFrames = 0;

  function cleanup() {
    try {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  }

  function encodeWav(): Blob {
    let len = 0;
    for (const c of chunks) len += c.length;
    const pcm = new Float32Array(len);
    let o = 0;
    for (const c of chunks) {
      pcm.set(c, o);
      o += c.length;
    }
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buf);
    const w = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    w(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    w(8, "WAVE");
    w(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    w(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    let p = 44;
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
    return new Blob([buf], { type: "audio/wav" });
  }

  function finalize(hadSpeech: boolean) {
    if (done) return;
    done = true;
    cleanup();
    if (hadSpeech) opts.onResult(encodeWav());
    else opts.onNoSpeech?.();
  }

  processor.onaudioprocess = (e) => {
    if (done) return;
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));

    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);

    // 头几帧估噪声底
    if (calibFrames < 4) {
      noiseFloor = Math.min(noiseFloor, rms) * 0.5 + noiseFloor * 0.5;
      calibFrames++;
    }
    const thresh = Math.min(0.05, Math.max(0.014, noiseFloor * 3 + 0.008));

    const now = performance.now();
    if (rms > thresh) {
      speechStarted = true;
      lastVoice = now;
    }

    if (speechStarted && now - lastVoice > silenceMs) {
      finalize(true);
    } else if (!speechStarted && now - t0 > noSpeechMs) {
      finalize(false);
    } else if (now - t0 > maxMs) {
      finalize(speechStarted);
    }
  };

  return {
    stop: () => finalize(speechStarted || chunks.length > 6),
    cancel: () => {
      if (done) return;
      done = true;
      cleanup();
    },
  };
}
