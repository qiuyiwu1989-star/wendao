"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startVoiceCapture, recorderSupported, type VoiceCapture } from "./recorder";
import { createSpeechQueue, speechSupported, type SpeechQueue } from "./speechQueue";

/**
 * 通话模式状态机 —— 免手连续语音对话的完整循环：
 *
 *   听(listening) → 识别(thinking) → [你的 LLM] → 说(speaking) → 自动回到听
 *
 * 这个 hook 只负责"听"和"说"，**LLM 由调用方掌控**：
 * 用户说完 → 触发 onUserSaid(text) → 你去调你自己的模型 → 把整句 push 回来朗读。
 *
 * 关键设计（都是踩坑换来的，别改）：
 * 1. **只在"听"阶段开麦**。思考/说话时必须关麦，否则会把自己的声音录进去（回声）。
 *    代价是没有"抢话打断"，用 interrupt() 手动打断代替。
 * 2. **同步门闩防重入**。双击开始/回听撞车会重复开麦、泄漏 MediaStream。
 * 3. **挂断竞态**：授权期间挂断要释放采集；转写结果回来时若已挂断要丢弃。
 * 4. **句级朗读**：整句一出就 say()，别等整段——合成与播放重叠才不卡。
 */

export type CallPhase = "idle" | "listening" | "thinking" | "speaking";

export type VoiceCallOptions = {
  /** 语音转文字接口：POST 原始 wav 字节 → {text} */
  asrUrl: string;
  /** 文字转语音接口：POST {text,voice} → 流式 PCM16（含 x-sample-rate 头） */
  ttsUrl: string;
  /** 音色（透传给 ttsUrl） */
  voice?: string;
  /**
   * 用户说完一句话时触发。在这里调你的 LLM，然后用 say() 逐句推回来朗读，
   * 结束时调 doneSaying()。不调 doneSaying 就不会自动回到"听"。
   */
  onUserSaid: (text: string, api: { say: (s: string) => void; doneSaying: () => void }) => void;
  /** 麦克风权限被拒 */
  onMicDenied?: () => void;
  /** 说完静音多久算说完，默认 650ms */
  silenceMs?: number;
};

export type VoiceCall = {
  phase: CallPhase;
  /** 录音时的实时音量 0-1，用来画波形 */
  level: number;
  active: boolean;
  /** 最近一次识别出的用户原话（可用于界面回显，确认有没有听错） */
  lastHeard: string;
  supported: boolean;
  start: () => void;
  end: () => void;
  /** 打断当前的想/说，立刻回到听 */
  interrupt: () => void;
};

export function voiceCallSupported(): boolean {
  return recorderSupported() && speechSupported();
}

export function useVoiceCall(opts: VoiceCallOptions): VoiceCall {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [active, setActive] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  const [level, setLevel] = useState(0);
  const [supported, setSupported] = useState(false);

  const captureRef = useRef<VoiceCapture | null>(null);
  const capturingRef = useRef(false); // 同步门闩，防重入
  const activeRef = useRef(false);
  const queueRef = useRef<SpeechQueue | null>(null);
  const listenRef = useRef<(() => void) | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    setSupported(voiceCallSupported());
  }, []);

  const stopSpeaking = useCallback(() => {
    queueRef.current?.stop();
    queueRef.current = null;
  }, []);

  const listen = useCallback(async () => {
    if (capturingRef.current) return; // 门闩：已在采集就不重入
    capturingRef.current = true;
    stopSpeaking();
    setPhase("listening");

    const startedActive = activeRef.current;
    const stale = () => startedActive && !activeRef.current; // 挂断竞态
    const done = () => {
      capturingRef.current = false;
      captureRef.current = null;
      setLevel(0);
    };
    const relisten = () => {
      if (activeRef.current)
        setTimeout(() => activeRef.current && listenRef.current?.(), 350);
    };

    try {
      const cap = await startVoiceCapture({
        silenceMs: optsRef.current.silenceMs ?? 650,
        onLevel: setLevel,
        onResult: async (wav) => {
          done();
          if (stale()) return;
          setPhase("thinking");
          let text = "";
          try {
            const res = await fetch(optsRef.current.asrUrl, {
              method: "POST",
              headers: { "content-type": "audio/wav" },
              body: wav,
            });
            if (res.ok) text = ((await res.json()) as { text?: string }).text?.trim() || "";
          } catch {
            /* 网络错：当作没听清 */
          }
          if (stale()) return;
          if (!text) return relisten();

          setLastHeard(text);
          // 建新队列前必须停掉旧的：每个队列有独立的 AudioContext 和时间游标，
          // 两个同时活着会各排各的时间轴 → 声音重叠
          stopSpeaking();
          // 交给调用方的 LLM；它用 say/doneSaying 把结果推回来
          const q = createSpeechQueue({
            url: optsRef.current.ttsUrl,
            voice: optsRef.current.voice,
            onStart: () => setPhase("speaking"),
            onDrain: () => {
              queueRef.current = null;
              relisten(); // 说完自动接着听——通话循环的闭合点
            },
          });
          queueRef.current = q;
          optsRef.current.onUserSaid(text, {
            say: (s) => q.push(s),
            doneSaying: () => q.end(),
          });
        },
        onNoSpeech: () => {
          done();
          relisten();
        },
        onError: (e) => {
          done();
          const name = (e as { name?: string } | undefined)?.name || "";
          if (/NotAllowed|Security|Permission/i.test(name)) {
            activeRef.current = false;
            setActive(false);
            setPhase("idle");
            optsRef.current.onMicDenied?.();
          } else relisten();
        },
      });
      // 授权期间被挂断：释放刚开的采集，别让麦克风常亮
      if (stale()) {
        cap.cancel();
        done();
        return;
      }
      captureRef.current = cap;
    } catch {
      done();
    }
  }, [stopSpeaking]);

  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  const start = useCallback(() => {
    activeRef.current = true;
    setActive(true);
    setLastHeard("");
    listen();
  }, [listen]);

  const end = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    captureRef.current?.cancel();
    captureRef.current = null;
    capturingRef.current = false;
    stopSpeaking();
    setPhase("idle");
  }, [stopSpeaking]);

  const interrupt = useCallback(() => {
    captureRef.current?.cancel();
    captureRef.current = null;
    capturingRef.current = false;
    stopSpeaking();
    setTimeout(() => activeRef.current && listenRef.current?.(), 150);
  }, [stopSpeaking]);

  // 卸载清理：别泄漏麦克风和 AudioContext
  useEffect(
    () => () => {
      activeRef.current = false;
      captureRef.current?.cancel();
      queueRef.current?.stop();
    },
    []
  );

  return { phase, active, level, lastHeard, supported, start, end, interrupt };
}
