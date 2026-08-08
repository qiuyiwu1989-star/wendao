// 服务端：小米 MiMo 的语音代理。密钥只在这一层，绝不下发到前端。
//
// 为什么要包一层而不是前端直连：① 密钥不能进浏览器；② MiMo 的 ASR/TTS 接口
// 位置很反直觉（见下），封装一次让各应用不用重复踩坑。

export type MimoConfig = {
  baseUrl?: string; // 默认 https://token-plan-cn.xiaomimimo.com
  apiKey: string;
  ttsModel?: string; // 默认 mimo-v2.5-tts
  asrModel?: string; // 默认 mimo-v2.5-asr
  defaultVoice?: string; // 默认 苏打（男声）
};

const DEFAULT_BASE = "https://token-plan-cn.xiaomimimo.com";
export const SAMPLE_RATE = 24000; // MiMo 流式 pcm16 固定 24kHz 单声道

/** 预置音色 */
export const VOICES = [
  { id: "苏打", gender: "男声" },
  { id: "白桦", gender: "男声" },
  { id: "冰糖", gender: "女声" },
  { id: "茉莉", gender: "女声" },
  { id: "Mia", gender: "英文女声" },
  { id: "Chloe", gender: "英文女声" },
  { id: "Milo", gender: "英文男声" },
  { id: "Dean", gender: "英文男声" },
];

/**
 * 语音转文字。
 * 坑：不是 /v1/audio/transcriptions（404），而是 /v1/chat/completions，
 * 音频放 **user 消息的 input_audio**。
 */
export async function transcribe(
  cfg: MimoConfig,
  wav: ArrayBuffer,
  format = "wav"
): Promise<string> {
  const base = cfg.baseUrl || DEFAULT_BASE;
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.asrModel || "mimo-v2.5-asr",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: Buffer.from(wav).toString("base64"), format },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ASR ${res.status}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (j.choices?.[0]?.message?.content || "").trim();
}

/**
 * 文字转语音（流式）。返回原始 PCM16 字节流，前端用 Web Audio 边收边放。
 * 坑：待朗读文本放 **assistant 角色消息**，音频在 delta.audio.data（base64）。
 */
export async function synthesizeStream(
  cfg: MimoConfig,
  text: string,
  voice?: string
): Promise<ReadableStream<Uint8Array>> {
  const base = cfg.baseUrl || DEFAULT_BASE;
  const upstream = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.ttsModel || "mimo-v2.5-tts",
      stream: true,
      messages: [{ role: "assistant", content: text }],
      audio: { format: "pcm16", voice: voice || cfg.defaultVoice || "苏打" },
    }),
  });
  if (!upstream.ok || !upstream.body) throw new Error(`TTS ${upstream.status}`);

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          let stop = false;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            // 收到 [DONE] 立刻收尾——MiMo 发完不一定关连接，死等会挂到超时
            if (payload === "[DONE]") {
              stop = true;
              break;
            }
            try {
              const chunk = JSON.parse(payload) as {
                choices?: { delta?: { audio?: { data?: string } } }[];
              };
              const d = chunk.choices?.[0]?.delta?.audio?.data;
              if (d) controller.enqueue(new Uint8Array(Buffer.from(d, "base64")));
            } catch {
              /* 跳过无法解析的行 */
            }
          }
          if (stop) break;
        }
      } catch {
        /* 读流出错：照常收尾 */
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        reader.cancel().catch(() => {});
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

/** 剥掉 Markdown / emoji，避免朗读出奇怪符号 */
export function stripForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-=]{3,}\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu,
      ""
    )
    .replace(/\n{2,}/g, "\n")
    .trim();
}
