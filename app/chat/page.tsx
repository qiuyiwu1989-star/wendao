"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  createSpeechQueue,
  speechSupported,
  takeSentences,
  type SpeechQueue,
} from "@/packages/voice/src/speechQueue";
import {
  startVoiceCapture,
  recorderSupported,
  type VoiceCapture,
} from "@/packages/voice/src/recorder";
import { useAuth } from "@/lib/useAuth";
import {
  extractSummary,
  saveSummary,
  loadSummaries,
  deleteSummary,
  syncSummaries,
  recordBets,
  listBets,
  settleBet,
  EMPTY_BET_STATS,
  type Summary,
  type StoredSummary,
  type Bet,
  type BetStats,
} from "@/lib/summary";
import {
  listConversations,
  loadConversation,
  saveConversation,
  deleteConversation,
  type ConvMeta,
} from "@/lib/conversations";
import {
  ArrowUp,
  BookOpen,
  Compass,
  Info,
  Lightbulb,
  LogIn,
  Mic,
  NotebookPen,
  PanelLeft,
  Phone,
  PhoneOff,
  Plus,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "wendao.chat.v1";
const TTS_PREF_KEY = "wendao.tts.on";
const VOICE_PREF_KEY = "wendao.voice";
const VOICES = [
  { id: "苏打", label: "苏打", gender: "男声" },
  { id: "白桦", label: "白桦", gender: "男声" },
  { id: "冰糖", label: "冰糖", gender: "女声" },
  { id: "茉莉", label: "茉莉", gender: "女声" },
];
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const API_URL = `${BASE}/api/chat`;
const TTS_URL = `${BASE}/api/tts`;
const ASR_URL = `${BASE}/api/asr`;
const FEED_URL = `${BASE}/api/feed`;

const STARTERS = [
  "我该不该辞职去创业？",
  "团队推不动项目，我很焦虑",
  "帮我彻底想清楚一件事",
  "这个判断背后我漏了什么？",
];

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  try {
    const html = marked.parse(text) as string;
    // 消毒：LLM 输出经 markdown→HTML 后可能含 <script>/onerror 等，直插 DOM 有 XSS 风险
    if (typeof window === "undefined") return html; // SSR 不会带内容走到这
    return DOMPurify.sanitize(html);
  } catch {
    return text;
  }
}

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ttsOn, setTtsOn] = useState(true);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0); // 录音实时音量 0-1，驱动波形动效
  const [holding, setHolding] = useState(false); // 对讲机模式：按住说话中
  const [willCancel, setWillCancel] = useState(false); // 上滑取消
  const [audioBlocked, setAudioBlocked] = useState(false); // 被浏览器自动播放策略挡住
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartY = useRef(0);
  const cancelRef = useRef(false);
  const [micSupported, setMicSupported] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [callMode, setCallMode] = useState(false);
  // 思考小结
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaries, setSummaries] = useState<StoredSummary[]>([]);
  const [showSummaries, setShowSummaries] = useState(false);
  const [bets, setBets] = useState<Bet[]>([]); // 挂着的账（还在赌的假设）
  // 各状态计数；其中 broken = 被推翻的判断数，是问道唯一在乎的成功指标
  const [betStats, setBetStats] = useState<BetStats>(EMPTY_BET_STATS);
  const [voice, setVoice] = useState("苏打");
  const [showVoices, setShowVoices] = useState(false);
  // 账号 + 云端历史
  const auth = useAuth();
  const [convId, setConvId] = useState<string | null>(null);
  const [history, setHistory] = useState<ConvMeta[]>([]);
  const [showLogin, setShowLogin] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const convIdRef = useRef<string | null>(null);
  convIdRef.current = convId;
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = auth.token;
  const feedBrainRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechRef = useRef<SpeechQueue | null>(null);
  const captureRef = useRef<VoiceCapture | null>(null);
  const capturingRef = useRef(false);
  const callActiveRef = useRef(false);
  const relistenRef = useRef<(() => void) | null>(null);

  // 载入本地历史 + 语音偏好
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
      const pref = localStorage.getItem(TTS_PREF_KEY);
      if (pref === "0") setTtsOn(false);
      const vp = localStorage.getItem(VOICE_PREF_KEY);
      if (vp && VOICES.some((v) => v.id === vp)) setVoice(vp);
    } catch {
      /* ignore */
    }
  }, []);

  // 离开页面时也投喂一次（关标签/刷新都算一场对话结束）
  useEffect(() => {
    const onLeave = () => {
      if (document.visibilityState === "hidden") feedBrainRef.current?.();
    };
    document.addEventListener("visibilitychange", onLeave);
    return () => document.removeEventListener("visibilitychange", onLeave);
  }, []);

  // 卸载时释放所有在途资源（未来若改 SPA 路由不至于泄漏 AudioContext/麦克风/请求）
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      audioRef.current?.pause();
      speechRef.current?.stop();
      captureRef.current?.cancel();
    };
  }, []);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    audioRef.current = null;
    if (speechRef.current) {
      speechRef.current.stop();
      speechRef.current = null;
    }
    setSpeaking(null);
  }, []);

  // 降级：一次性拿完整 wav 再播（Web Audio 不可用时）
  const speakWav = useCallback(async (text: string, index: number) => {
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, stream: false }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    setSpeaking(index);
    const clear = () => {
      URL.revokeObjectURL(url);
      setSpeaking((cur) => (cur === index ? null : cur));
    };
    audio.onended = clear;
    audio.onerror = clear;
    await audio.play().catch(() => setSpeaking(null));
  }, []);

  // 新建一个句级语音队列（自动播放 + 手动重听共用）
  const newQueue = useCallback((index: number): SpeechQueue => {
    // 必须先停掉上一个队列：每个队列有自己的 AudioContext 和时间游标，
    // 两个同时活着会各排各的 → 声音重叠（用户在问道说话时又发一条就会触发）
    speechRef.current?.stop();
    speechRef.current = null;
    const q = createSpeechQueue({
      url: TTS_URL,
      voice,
      onBlocked: () => setAudioBlocked(true),
      onStart: () => {
        setAudioBlocked(false);
        setSpeaking(index);
      },
      onDrain: () => {
        setSpeaking((cur) => (cur === index ? null : cur));
        // 通话模式：问道说完，自动接着听用户
        if (callActiveRef.current) relistenRef.current?.();
      },
    });
    speechRef.current = q;
    return q;
  }, [voice]);

  const pickVoice = useCallback((id: string) => {
    setVoice(id);
    setShowVoices(false);
    try {
      localStorage.setItem(VOICE_PREF_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  // 手动重听整段：整段作为一句推进队列
  const speak = useCallback(
    async (text: string, index: number) => {
      stopAudio();
      const clean = text.trim();
      if (!clean) return;
      if (speechSupported()) {
        const q = newQueue(index);
        q.push(clean);
        q.end();
        return;
      }
      try {
        await speakWav(clean, index);
      } catch {
        setSpeaking(null);
      }
    },
    [stopAudio, speakWav, newQueue]
  );

  const toggleTts = useCallback(() => {
    setTtsOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TTS_PREF_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next) stopAudio();
      return next;
    });
  }, [stopAudio]);

  // 持久化（只存最近 80 条，避免历史无限增长撑爆 localStorage 后静默失效）
  useEffect(() => {
    try {
      const slim = messages.length > 80 ? messages.slice(-80) : messages;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }, [messages]);

  // ---------- 云端历史 ----------
  const refreshBets = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    const { bets, stats } = await listBets(t);
    setBets(bets);
    setBetStats(stats);
  }, []);

  const refreshHistory = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    setHistory(await listConversations(t));
  }, []);

  // 把当前会话存云端（登录才存）。返回/记录 convId 以便后续更新同一条
  const persistCloud = useCallback(
    async (msgs: Msg[]) => {
      const t = tokenRef.current;
      if (!t || msgs.length < 2) return;
      const id = await saveConversation(t, {
        id: convIdRef.current,
        messages: msgs,
      });
      if (id) {
        if (id !== convIdRef.current) setConvId(id);
        refreshHistory();
      }
    },
    [refreshHistory]
  );

  // 登录后：拉历史；若手头有本地对话且还没云端 id，迁移上去
  useEffect(() => {
    if (!auth.userId || !auth.token) return;
    refreshHistory();
    refreshBets();
    if (messages.length >= 2 && !convIdRef.current) persistCloud(messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.userId, auth.token]);

  const openConversation = useCallback(
    async (id: string) => {
      const t = tokenRef.current;
      if (!t) return;
      const conv = await loadConversation(t, id);
      if (conv) {
        setMessages(conv.messages);
        setConvId(conv.id);
        setShowHistory(false);
      }
    },
    []
  );

  // 向上喂：一场对话收尾时投喂回深脑（后台跑，不打扰用户；同一场只喂一次）
  const fedRef = useRef<string | null>(null);
  const feedBrain = useCallback((msgs: Msg[]) => {
    if (msgs.length < 4) return; // 太短没沉淀价值
    const sig = String(msgs.length) + (msgs[0]?.content || "").slice(0, 20);
    if (fedRef.current === sig) return;
    fedRef.current = sig;
    const t = tokenRef.current;
    if (!t) return; // 未登录不投喂（服务端也会拒，这里省一次请求）
    fetch(FEED_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${t}`,
      },
      body: JSON.stringify({ messages: msgs }),
      keepalive: true, // 允许在页面关闭时继续发出
    }).catch(() => {});
  }, []);

  feedBrainRef.current = () => feedBrain(messages);

  // 载入已存的小结（累积感的来源）
  useEffect(() => {
    setSummaries(loadSummaries());
  }, []);

  // 登录后把本地攒下的小结同步上云——这就是"沉淀跟着人走"。
  // 存在问道自己的表里（按 user_id 隔离），深脑用同一账号即可接过去。
  const [syncedCount, setSyncedCount] = useState(0);
  useEffect(() => {
    if (!auth.token) return;
    const local = loadSummaries();
    if (!local.length) return;
    syncSummaries(auth.token, local).then((n) => {
      if (n > 0) setSyncedCount(n);
    });
  }, [auth.token]);

  // 提炼这场对话的小结
  const summarize = useCallback(async () => {
    if (summarizing) return;
    const turns = messages.filter((m) => m.role === "user").length;
    if (turns < 2) return;
    setSummarizing(true);
    const s = await extractSummary(messages);
    setSummarizing(false);
    if (s) {
      setSummary(s);
      const stored = saveSummary(s);
      setSummaries(loadSummaries());
      // 「还在赌」的记进账本——到期问道会主动翻出来问（COUNTERPARTY 职能②）
      const t = tokenRef.current;
      if (t)
        recordBets(t, stored).then((n) => {
          if (n) refreshBets();
        });
    }
  }, [messages, summarizing]);

  const canSummarize =
    messages.filter((m) => m.role === "user").length >= 2 && !streaming;

  const newChat = useCallback(() => {
    feedBrain(messages);
    setMessages([]);
    setConvId(null);
    setShowHistory(false);
    fedRef.current = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [messages, feedBrain]);

  const removeConversation = useCallback(
    async (id: string) => {
      const t = tokenRef.current;
      if (!t) return;
      await deleteConversation(t, id);
      if (id === convIdRef.current) newChat();
      refreshHistory();
    },
    [refreshHistory, newChat]
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const autoGrow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;

      const next: Msg[] = [...messages, { role: "user", content }];
      setMessages([...next, { role: "assistant", content: "" }]);
      setInput("");
      setStreaming(true);
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = "auto";
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // 带上登录态：服务端据此判断能否用深脑 grounding（白名单本人才给）
            ...(tokenRef.current
              ? { authorization: `Bearer ${tokenRef.current}` }
              : {}),
          },
          // fast=ttsOn：要听语音就走无思考抢延迟；纯打字保留思考
          body: JSON.stringify({ messages: next, fast: ttsOn }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "");
          throw new Error(errText || `请求失败（${res.status}）`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const assistantIndex = next.length;

        // 句级流式朗读：整句一出就推进队列，不等整段。
        // 规则很简单，不猜用户意图：**喇叭开就念，喇叭关就不念**。
        // 关着也想听某一条时，点那条下面的「朗读」按钮即可（不受开关限制）。
        const autoSpeak = ttsOn;
        const pipeline = autoSpeak && speechSupported();
        const queue = pipeline ? newQueue(assistantIndex) : null;
        let spokenLen = 0;
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const copy = prev.slice();
            copy[copy.length - 1] = { role: "assistant", content: acc };
            return copy;
          });
          if (queue) {
            const { segments, next: n } = takeSentences(acc, spokenLen, {
              firstChunkFast: true,
            });
            for (const s of segments) queue.push(s);
            spokenLen = n;
          }
        }
        if (queue) {
          const tail = acc.slice(spokenLen).trim();
          if (tail) queue.push(tail);
          queue.end();
        } else if (autoSpeak && acc.trim()) {
          // Web Audio 不可用：整段 wav 降级
          speak(acc, assistantIndex);
        }
        // 登录了就把这一整段对话存到云端
        if (acc.trim())
          persistCloud([...next, { role: "assistant", content: acc }]);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // 用户主动停止：保留已生成内容
        } else {
          const msg = err instanceof Error ? err.message : "网络错误";
          setMessages((prev) => {
            const copy = prev.slice();
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = {
              role: "assistant",
              content: (last?.content || "") + `\n\n[连接问道失败：${msg}]`,
            };
            return copy;
          });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming, ttsOn, speak, newQueue, persistCloud]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    stopAudio();
  }, [stopAudio]);

  const reset = useCallback(() => {
    if (streaming) stop();
    stopAudio();
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [streaming, stop, stopAudio]);

  // 语音输入：MediaRecorder + VAD 录音 → MiMo ASR 转写（不用浏览器 Web Speech，
  // 后者走谷歌服务器国内被墙）。说完静音自动收尾。
  useEffect(() => {
    setMicSupported(recorderSupported());
  }, []);

  const transcribe = useCallback(async (wav: Blob): Promise<string> => {
    try {
      const res = await fetch(ASR_URL, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: wav,
      });
      if (!res.ok) return "";
      const j = (await res.json()) as { text?: string };
      return (j.text || "").trim();
    } catch {
      return "";
    }
  }, []);

  const stopCapture = useCallback(() => {
    captureRef.current?.stop();
  }, []);

  const listen = useCallback(async (pushToTalk = false) => {
    // capturingRef 是同步门闩：挡住重入（双击/relisten 撞车）导致重复开麦、MediaStream 泄漏
    if (streaming || capturingRef.current) return;
    capturingRef.current = true;
    const startedInCall = callActiveRef.current;
    stopAudio();
    setListening(true);
    const finishCapture = () => {
      capturingRef.current = false;
      captureRef.current = null;
      setLevel(0);
      setListening(false);
    };
    // 挂断竞态：这轮采集若在通话结束后才出结果，丢弃
    const stale = () => startedInCall && !callActiveRef.current;
    const relisten = () => {
      if (callActiveRef.current)
        setTimeout(() => callActiveRef.current && relistenRef.current?.(), 350);
    };
    try {
      const cap = await startVoiceCapture({
        pushToTalk,
        onLevel: setLevel,
        onResult: async (wav) => {
          finishCapture();
          if (stale()) return;
          if (cancelRef.current) {
            cancelRef.current = false;
            return; // 上滑取消：录了也不发
          }
          setTranscribing(true);
          const text = await transcribe(wav);
          setTranscribing(false);
          if (stale()) return;
          if (text) {
            setInput(text);
            send(text);
          } else relisten();
        },
        onNoSpeech: () => {
          finishCapture();
          relisten();
        },
        onError: (e) => {
          finishCapture();
          const name = (e as { name?: string } | undefined)?.name || "";
          if (/NotAllowed|Security|Permission/i.test(name)) {
            // 权限被拒：别无限重试，退出通话并提示
            callActiveRef.current = false;
            setCallMode(false);
            setMicDenied(true);
          } else {
            relisten(); // 瞬时错误：通话中重试
          }
        },
      });
      // getUserMedia 授权期间被挂断：释放刚开的采集，别让麦克风常亮
      if (stale()) {
        cap.cancel();
        finishCapture();
        return;
      }
      captureRef.current = cap;
    } catch {
      finishCapture();
    }
  }, [streaming, stopAudio, transcribe, send]);

  useEffect(() => {
    relistenRef.current = () => listen(false); // 通话回听始终走免手模式
  }, [listen]);

  // 进通话前预热 MiMo prompt cache：偷偷发一个 fast 请求跑完系统提示词 prefill，
  // 让第一轮不吃冷启动的几秒。拿到首字节就断（缓存已暖），不影响 UI。
  const prewarm = useCallback(() => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 6000); // 兜底：别留悬挂请求
    fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "在吗" }], fast: true }),
      signal: ac.signal,
    })
      .then(async (res) => {
        const reader = res.body?.getReader();
        await reader?.read(); // 收到第一块即说明 prefill 完成、缓存已暖
        clearTimeout(timer);
        ac.abort();
      })
      .catch(() => clearTimeout(timer));
  }, []);

  const toggleMic = useCallback(() => {
    if (listening) stopCapture();
    else listen();
  }, [listening, listen, stopCapture]);

  // 麦克风按钮双模：
  //   短按 → 免手模式（VAD，说完自动发）
  //   长按 → 对讲机（按住说、松开发，上滑取消）—— 嘈杂环境或说长句时更可控
  const HOLD_MS = 260;
  const CANCEL_DIST = 60;

  const onMicDown = useCallback(
    (e: React.PointerEvent) => {
      if (streaming || transcribing) return;
      holdStartY.current = e.clientY;
      cancelRef.current = false;
      setWillCancel(false);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        if (listening) stopCapture(); // 已在免手录音就先收掉
        setHolding(true);
        listen(true); // 对讲机模式
      }, HOLD_MS);
    },
    [streaming, transcribing, listening, listen, stopCapture]
  );

  const onMicMove = useCallback(
    (e: React.PointerEvent) => {
      if (!holding) return;
      const up = holdStartY.current - e.clientY;
      const c = up > CANCEL_DIST;
      cancelRef.current = c;
      setWillCancel(c);
    },
    [holding]
  );

  const onMicUp = useCallback(() => {
    if (holdTimer.current) {
      // 没到长按时长 → 当作短按，走免手模式
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      toggleMic();
      return;
    }
    if (holding) {
      setHolding(false);
      setWillCancel(false);
      stopCapture(); // 松手即收尾；cancelRef 决定发不发
    }
  }, [holding, stopCapture, toggleMic]);

  const startCall = useCallback(() => {
    setMicDenied(false);
    callActiveRef.current = true;
    setCallMode(true);
    if (!ttsOn) toggleTts(); // 通话必须能出声
    stopAudio();
    prewarm(); // 用户授权麦克风/开口这几秒里把缓存焐热
    listen();
  }, [ttsOn, toggleTts, stopAudio, listen, prewarm]);

  const endCall = useCallback(() => {
    callActiveRef.current = false;
    setCallMode(false);
    captureRef.current?.cancel();
    captureRef.current = null;
    capturingRef.current = false;
    setListening(false);
    setTranscribing(false);
    stopAudio();
    if (streaming) abortRef.current?.abort();
    setInput("");
    feedBrain(messages); // 挂断=一场对话收尾，投喂回深脑
  }, [stopAudio, streaming, messages, feedBrain]);

  // 通话中点一下：打断当前（跳过问道正在说/在想的），立刻回到听
  const interruptCall = useCallback(() => {
    if (streaming) abortRef.current?.abort();
    captureRef.current?.cancel();
    captureRef.current = null;
    capturingRef.current = false;
    stopAudio();
    setTimeout(() => callActiveRef.current && listen(), 150);
  }, [streaming, stopAudio, listen]);

  const callPhase = speaking !== null
    ? "speaking"
    : streaming || transcribing
    ? "thinking"
    : listening
    ? "listening"
    : "idle";

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const empty = messages.length === 0;

  // 通话屏上显示最近一轮，避免"盲对话"（也能看出 ASR 有没有听错）
  const lastUserSaid = callMode
    ? [...messages].reverse().find((m) => m.role === "user")?.content || ""
    : "";
  const lastReply =
    callMode &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant"
      ? messages[messages.length - 1].content
      : "";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Compass size={20} strokeWidth={1.6} />
          </div>
          <div>
            <div className="brand-name">问道</div>
            <div className="brand-sub">深度思考教练 · 深脑出品</div>
          </div>
        </div>
        <div className="topbar-actions">
          {canSummarize && (
            <button
              className="icon-btn"
              onClick={summarize}
              disabled={summarizing}
              title="小结这次思考"
            >
              <NotebookPen size={18} strokeWidth={1.7} />
            </button>
          )}
          {summaries.length > 0 && (
            <button
              className="icon-btn"
              onClick={() => setShowSummaries(true)}
              title={`我想清楚的事（${summaries.length}）`}
            >
              <Lightbulb size={18} strokeWidth={1.7} />
            </button>
          )}
          {micSupported && (
            <button
              className="icon-btn"
              onClick={startCall}
              title="通话模式（免手对话）"
            >
              <Phone size={18} strokeWidth={1.7} />
            </button>
          )}
          <a className="icon-btn" href={`${BASE}/`} title="问道是什么">
            <Info size={18} strokeWidth={1.7} />
          </a>
          <a className="icon-btn" href={`${BASE}/about`} title="方法论详解">
            <BookOpen size={18} strokeWidth={1.7} />
          </a>
          <button
            className={"icon-btn" + (ttsOn ? " icon-btn-on" : "")}
            onClick={toggleTts}
            title={ttsOn ? "语音已开（点击静音）" : "语音已关（点击开启）"}
          >
            {ttsOn ? (
              <Volume2 size={18} strokeWidth={1.7} />
            ) : (
              <VolumeX size={18} strokeWidth={1.7} />
            )}
          </button>
          <div className="voice-wrap">
            <button
              className={"icon-btn" + (showVoices ? " icon-btn-on" : "")}
              onClick={() => setShowVoices((s) => !s)}
              title="音色"
            >
              <Settings2 size={18} strokeWidth={1.7} />
            </button>
            {showVoices && (
              <>
                <div
                  className="voice-backdrop"
                  onClick={() => setShowVoices(false)}
                />
                <div className="voice-pop">
                  <div className="voice-pop-title">问道的声音</div>
                  {VOICES.map((v) => (
                    <button
                      key={v.id}
                      className={"voice-item" + (voice === v.id ? " on" : "")}
                      onClick={() => pickVoice(v.id)}
                    >
                      <span>{v.label}</span>
                      <span className="voice-g">{v.gender}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {!empty && (
            <button
              className="icon-btn"
              onClick={auth.userId ? newChat : reset}
              title="新的对话"
            >
              <RotateCcw size={18} strokeWidth={1.7} />
            </button>
          )}
          {auth.enabled && auth.ready && auth.userId && (
            <button
              className="icon-btn"
              onClick={() => {
                refreshHistory();
                setShowHistory(true);
              }}
              title="我的对话"
            >
              <PanelLeft size={18} strokeWidth={1.7} />
            </button>
          )}
          {auth.enabled && auth.ready && !auth.userId && (
            <button
              className="icon-btn icon-btn-on"
              onClick={() => setShowLogin(true)}
              title="登录 / 注册"
            >
              <LogIn size={18} strokeWidth={1.7} />
            </button>
          )}
        </div>
      </header>

      {callMode && (
        <div className="call" role="dialog" aria-modal="true">
          <div className="call-inner">
            <div className="call-title">通话模式</div>
            <button
              className={`call-orb call-${callPhase}`}
              onClick={interruptCall}
              title="点一下可打断"
            >
              <Compass size={44} strokeWidth={1.2} />
            </button>
            {callPhase === "listening" && (
              <div className="call-wave">
                <Waveform level={level} bars={18} />
              </div>
            )}
            <div className="call-state">
              {callPhase === "listening"
                ? "在听你说……"
                : callPhase === "thinking"
                ? "问道在想……"
                : callPhase === "speaking"
                ? "问道在说……"
                : "……"}
            </div>
            <div className="call-hint">
              {callPhase === "speaking" || callPhase === "thinking"
                ? "点圆圈可打断，直接说"
                : "说完停一下，问道自然会接话"}
            </div>
            {(lastUserSaid || lastReply) && (
              <div className="call-transcript">
                {lastUserSaid && (
                  <div className="call-you">你：{lastUserSaid}</div>
                )}
                {lastReply && <div className="call-reply">{lastReply}</div>}
              </div>
            )}
            <button className="call-end" onClick={endCall}>
              <PhoneOff size={18} strokeWidth={1.9} />
              结束通话
            </button>
          </div>
        </div>
      )}

      {summary && (
        <SummaryCard
          summary={summary}
          signedIn={!!auth.userId}
          onClose={() => setSummary(null)}
        />
      )}
      {showSummaries && (
        <SummaryList
          items={summaries}
          bets={bets}
          betStats={betStats}
          onSettle={async (id, st) => {
            const t = tokenRef.current;
            if (!t) return;
            await settleBet(t, id, st);
            refreshBets();
          }}
          signedIn={!!auth.userId}
          syncedCount={syncedCount}
          onSignIn={() => {
            setShowSummaries(false);
            setShowLogin(true);
          }}
          onDelete={(id) => {
            deleteSummary(id);
            setSummaries(loadSummaries());
          }}
          onClose={() => setShowSummaries(false)}
        />
      )}
      {showLogin && (
        <LoginModal auth={auth} onClose={() => setShowLogin(false)} />
      )}
      {showHistory && (
        <HistoryDrawer
          history={history}
          currentId={convId}
          email={auth.email}
          onOpen={openConversation}
          onNew={newChat}
          onDelete={removeConversation}
          onSignOut={async () => {
            await auth.signOut();
            setHistory([]);
            setConvId(null);
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}

      {empty ? (
        <div className="hero">
          <h1 className="hero-title">问道</h1>
          <p className="hero-tag">不给答案，带你把问题想清楚。</p>
          <div className="starters">
            {STARTERS.map((s) => (
              <button
                key={s}
                className="starter"
                onClick={() => send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="scroll" ref={scrollRef}>
          {messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div className="msg msg-user" key={i}>
                  <div className="bubble-user">{m.content}</div>
                </div>
              );
            }
            const isLast = i === messages.length - 1;
            const showCursor = streaming && isLast;
            const isSpeaking = speaking === i;
            return (
              <div className="msg msg-assistant" key={i}>
                <div className={"avatar" + (isSpeaking ? " avatar-speaking" : "")}>
                  <Compass size={17} strokeWidth={1.7} />
                </div>
                <div className="assistant-body">
                  {m.content ? (
                    <div
                      className="prose"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(m.content),
                      }}
                    />
                  ) : null}
                  {showCursor && <span className="cursor" />}
                  {m.content && !showCursor && (
                    <button
                      className={"speak-btn" + (isSpeaking ? " speak-btn-on" : "")}
                      onClick={() =>
                        isSpeaking ? stopAudio() : speak(m.content, i)
                      }
                      title={isSpeaking ? "停止朗读" : "朗读这段"}
                    >
                      {isSpeaking ? (
                        <VolumeX size={14} strokeWidth={1.8} />
                      ) : (
                        <Volume2 size={14} strokeWidth={1.8} />
                      )}
                      <span>{isSpeaking ? "朗读中" : "朗读"}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="composer">
        <div className={"composer-inner" + (listening ? " composer-listening" : "")}>
          {micSupported && (
            <button
              className={
                "mic-btn" +
                (listening ? " mic-btn-on" : "") +
                (holding ? " mic-btn-hold" : "") +
                (willCancel ? " mic-btn-cancel" : "")
              }
              onPointerDown={onMicDown}
              onPointerMove={onMicMove}
              onPointerUp={onMicUp}
              onPointerCancel={onMicUp}
              onPointerLeave={() => holding && onMicUp()}
              disabled={streaming || transcribing}
              title={holding ? "松开发送，上滑取消" : "点一下免手说；按住说完松开发送"}
            >
              <Mic size={18} strokeWidth={1.8} />
            </button>
          )}
          {(listening || holding) && (
            <Waveform level={level} hint={holding ? (willCancel ? "松开取消" : "松开发送 · 上滑取消") : ""} />
          )}
          <textarea
            ref={taRef}
            value={input}
            className={listening ? "ta-listening" : ""}
            placeholder={
              transcribing
                ? "识别中……"
                : listening || holding
                ? ""
                : "说说你正在纠结、想不通的那件事……"
            }
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={onKeyDown}
          />
          {streaming ? (
            <button className="send-btn" onClick={stop} title="停止">
              <Square size={16} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={() => {
                          send(input);
              }}
              disabled={!input.trim()}
              title="发送"
            >
              <ArrowUp size={20} strokeWidth={2.2} />
            </button>
          )}
        </div>
        <p className="composer-hint">
          {audioBlocked
            ? "浏览器挡住了自动播放——点一下页面任意处即可开启声音"
            : micDenied
            ? "麦克风没授权——点地址栏左侧的锁/图标，允许麦克风后再试"
            : micSupported
            ? "点麦克风说，或打字都行 · 喇叭开着就会念给你听"
            : "问道会把回答读给你听 · 短而准，一句话点醒 · Enter 发送"}
        </p>
      </div>
    </div>
  );
}

function LoginModal({
  auth,
  onClose,
}: {
  auth: ReturnType<typeof useAuth>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!email.trim() || pw.length < 6) {
      setErr("填邮箱 + 至少 6 位密码");
      return;
    }
    setBusy(true);
    setErr(null);
    const e =
      mode === "in"
        ? await auth.signIn(email, pw)
        : await auth.signUp(email, pw);
    setBusy(false);
    if (e) setErr(e);
    else onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} title="关闭">
          <X size={18} strokeWidth={1.8} />
        </button>
        <div className="modal-title">
          {mode === "in" ? "登录问道" : "注册问道"}
        </div>
        <div className="modal-sub">登录后，对话会存到云端、换设备也在</div>
        <input
          className="modal-input"
          type="email"
          inputMode="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="modal-input"
          type="password"
          placeholder="密码（至少 6 位）"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <div className="modal-err">{err}</div>}
        <button className="modal-submit" onClick={submit} disabled={busy}>
          {busy ? "稍等……" : mode === "in" ? "登录" : "注册并登录"}
        </button>
        <div className="modal-switch">
          {mode === "in" ? (
            <>
              还没账号？
              <button onClick={() => { setMode("up"); setErr(null); }}>去注册</button>
            </>
          ) : (
            <>
              已有账号？
              <button onClick={() => { setMode("in"); setErr(null); }}>去登录</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryDrawer({
  history,
  currentId,
  email,
  onOpen,
  onNew,
  onDelete,
  onSignOut,
  onClose,
}: {
  history: ConvMeta[];
  currentId: string | null;
  email: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="drawer-title">我的对话</span>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <button className="drawer-new" onClick={onNew}>
          <Plus size={16} strokeWidth={2} />
          新对话
        </button>
        <div className="drawer-list">
          {history.length === 0 ? (
            <div className="drawer-empty">还没有存下的对话</div>
          ) : (
            history.map((c) => (
              <div
                key={c.id}
                className={"drawer-item" + (c.id === currentId ? " on" : "")}
              >
                <button className="drawer-item-open" onClick={() => onOpen(c.id)}>
                  {c.title || "新对话"}
                </button>
                <button
                  className="drawer-item-del"
                  onClick={() => onDelete(c.id)}
                  title="删除"
                >
                  <Trash2 size={15} strokeWidth={1.8} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="drawer-foot">
          <span className="drawer-email">{email}</span>
          <button className="drawer-signout" onClick={onSignOut}>
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 输入波形：用录音的**真实音量**驱动，不是假动画。
 * 每根柱子有自己的相位和权重，看起来像音频律动而不是整齐的呼吸。
 */
function Waveform({
  level,
  bars = 20,
  hint,
}: {
  level: number;
  bars?: number;
  hint?: string;
}) {
  return (
    <div className="wave" aria-hidden>
      {hint && <span className="wave-hint">{hint}</span>}
      {Array.from({ length: bars }).map((_, i) => {
        // 中间高两边低，配合音量得到自然的包络
        const center = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        const weight = 0.3 + center * 0.7;
        // 增益调大 + 底噪抬高：小声也看得见起伏，大声更有冲击
        const h = 18 + Math.min(1, level * 1.6) * 105 * weight;
        return (
          <span
            key={i}
            className="wave-bar"
            style={{
              height: `${Math.min(100, h)}%`,
              animationDelay: `${(i % 5) * 90}ms`,
              opacity: 0.55 + center * 0.45,
            }}
          />
        );
      })}
    </div>
  );
}

function SummaryCard({
  summary,
  signedIn,
  onClose,
}: {
  summary: Summary;
  signedIn: boolean;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sum-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} title="关闭">
          <X size={18} strokeWidth={1.8} />
        </button>
        <div className="sum-eyebrow">这次你想清楚的</div>
        <div className="sum-title">{summary.title}</div>
        <div className="sum-list">
          {summary.judgments.map((j, i) => (
            <div className="sum-item" key={i}>
              <span className={`sum-tag sum-tag-${j.type}`}>{j.type}</span>
              <div className="sum-text">{j.text}</div>
              {j.basis && <div className="sum-basis">“{j.basis}”</div>}
            </div>
          ))}
        </div>
        {summary.takeaway && (
          <div className="sum-takeaway">{summary.takeaway}</div>
        )}
        <div className="sum-foot">
          {signedIn
            ? "已存下 · 已同步到云端，深脑里能接着用"
            : "已存下 · 登录后自动跟着你走，进深脑时就在那儿"}
        </div>
      </div>
    </div>
  );
}

function SummaryList({
  items,
  bets,
  betStats,
  onSettle,
  signedIn,
  syncedCount,
  onSignIn,
  onDelete,
  onClose,
}: {
  items: StoredSummary[];
  bets: Bet[];
  betStats: BetStats;
  onSettle: (id: string, status: "held" | "broken" | "dropped") => void;
  signedIn: boolean;
  syncedCount: number;
  onSignIn: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="drawer-title">我想清楚的事</span>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <div className="sum-count">
          已经想清楚 {items.length} 件事
          {signedIn && syncedCount > 0 && ` · 已同步 ${syncedCount} 条上云`}
        </div>
        <div className="drawer-list">
          {/*
            COUNTERPARTY.md 第四节：问道成功的唯一标准，是用户有没有因为它改掉过一个判断。
            所以这个数字必须是抽屉里最大的那个——比"想清楚了几件事"更大。
            N=0 时照样显示，且不粉饰：0 是一句真话，藏起来才是在讨好自己。
            未登录时账本在云端读不到，显示 0 会是假的，所以整块不渲染。
          */}
          {signedIn && (
            <div className="broken-metric">
              <div className="broken-metric-line">
                推翻过 <span className="broken-metric-n">{betStats.broken}</span> 个判断
              </div>
              <div className="broken-metric-note">
                {betStats.broken === 0
                  ? "这是问道唯一在乎的指标，现在它是 0——说明到目前为止，问道只在帮你加固想法，没在帮你思考。"
                  : "这是问道唯一在乎的指标：不是聊了多少次，是你因为它改掉过几个判断。它要是长期不动，说明问道只在帮你加固想法。"}
              </div>
            </div>
          )}
          {bets.length > 0 && (
            <div className="bets">
              <div className="bets-head">
                还没验的 {bets.length} 笔
                {bets.some((b) => b.overdue) && (
                  <span className="bets-overdue">
                    · {bets.filter((b) => b.overdue).length} 笔到期了
                  </span>
                )}
              </div>
              {bets.map((b) => (
                <div className={"bet" + (b.overdue ? " bet-due" : "")} key={b.id}>
                  <div className="bet-claim">{b.claim}</div>
                  {b.basis && <div className="bet-basis">“{b.basis}”</div>}
                  <div className="bet-acts">
                    <button onClick={() => onSettle(b.id, "held")}>验了，成立</button>
                    <button onClick={() => onSettle(b.id, "broken")}>验了，不成立</button>
                    <button className="bet-drop" onClick={() => onSettle(b.id, "dropped")}>
                      不验了
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {items.map((s) => (
            <div className="sum-row" key={s.id}>
              <div className="sum-row-main">
                <div className="sum-row-title">{s.title}</div>
                {s.takeaway && (
                  <div className="sum-row-take">{s.takeaway}</div>
                )}
              </div>
              <button
                className="drawer-item-del"
                onClick={() => onDelete(s.id)}
                title="删除"
              >
                <Trash2 size={15} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
        <div className="drawer-foot sum-drawer-foot">
          {signedIn ? (
            <>
              <div className="sum-hint">
                这些判断已经跟着你的账号存下了。进深脑，让它们和你的其他积累连起来。
              </div>
              <a className="sum-cta" href="https://shennao.zaowuyun.com">
                去深脑看全貌 →
              </a>
            </>
          ) : (
            <>
              <div className="sum-hint">
                现在只存在这台设备上。登录后会跟着你走——换设备、进深脑都还在。
              </div>
              <button className="sum-cta" onClick={onSignIn}>
                登录，把它们存下来
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
