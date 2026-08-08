# @qiuyiwu1989-star/voice · 语音交互能力模组

给造物云生态里任何应用（深脑 / 略懂 / InnoLab / 问道…）加上**打电话一样的语音对话**。

从「问道」抽出来的实战代码。**它的价值不只是省 500 行，是省掉下面那些坑**——
这些每一条都是线上踩出来的，重踩一次少则半天，多则一次事故。

```
听(录音+静音检测) → 识别(ASR) → 你的 LLM → 说(句级流式朗读) → 自动接着听
```

---

## 三层，按需取用

| 层 | 用什么 | 适合 |
|---|---|---|
| **完整通话** | `useVoiceCall()` | 想要"打电话"体验，一个 hook 搞定 |
| **单项能力** | `startVoiceCapture()` / `createSpeechQueue()` | 只要录音、或只要朗读 |
| **服务端** | `server/mimo.ts` | 代理 MiMo，密钥只在服务端 |

---

## 安装（GitHub Packages）

包发布在 GitHub Packages，**装之前要先配 registry 和认证**（私有源必需，一次性）：

```bash
# 1) 在你的项目根目录建 .npmrc（把 <TOKEN> 换成有 read:packages 权限的 GitHub token）
cat >> .npmrc <<'NPMRC'
@qiuyiwu1989-star:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<TOKEN>
NPMRC

# 2) 装
npm i @qiuyiwu1989-star/voice
```

> `.npmrc` 里有 token，**务必加进 .gitignore**。CI 里用 `NODE_AUTH_TOKEN` 环境变量替代。

Next.js 消费方无需额外配置（包已编译为 JS + 类型声明，`"use client"` 已保留）。

---

## 快速接入

### 1. 服务端：两个代理路由（密钥不下发前端）

```ts
// app/api/asr/route.ts
import { transcribe } from "@qiuyiwu1989-star/voice/server/mimo";
export async function POST(req: Request) {
  const wav = await req.arrayBuffer();
  if (wav.byteLength > 8_000_000) return new Response("too large", { status: 413 });
  const text = await transcribe({ apiKey: process.env.LLM_API_KEY! }, wav);
  return Response.json({ text });
}

// app/api/tts/route.ts
import { synthesizeStream, stripForSpeech, SAMPLE_RATE } from "@qiuyiwu1989-star/voice/server/mimo";
export async function POST(req: Request) {
  const { text, voice } = await req.json();
  const stream = await synthesizeStream(
    { apiKey: process.env.LLM_API_KEY! },
    stripForSpeech(text).slice(0, 800),
    voice
  );
  return new Response(stream, {
    headers: { "content-type": "application/octet-stream", "x-sample-rate": String(SAMPLE_RATE) },
  });
}
```

### 2. 前端：一个 hook

```tsx
import { useVoiceCall, takeSentences } from "@qiuyiwu1989-star/voice";

const call = useVoiceCall({
  asrUrl: "/api/asr",
  ttsUrl: "/api/tts",
  voice: "苏打",
  onUserSaid: async (text, { say, doneSaying }) => {
    // 用户说完了。这里调你自己的 LLM，整句一出就 say()，说完 doneSaying()
    const res = await fetch("/api/chat", { method: "POST", body: JSON.stringify({ text }) });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let acc = "", spoken = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += dec.decode(value, { stream: true });
      const { segments, next } = takeSentences(acc, spoken); // 切出已完成的整句
      segments.forEach(say);
      spoken = next;
    }
    const tail = acc.slice(spoken).trim();
    if (tail) say(tail);
    doneSaying(); // 不调这个就不会自动回到"听"
  },
});

// call.phase: idle | listening | thinking | speaking
// call.start() / call.end() / call.interrupt()
// call.lastHeard  ← 识别出的原话，建议显示出来（用户能看出有没有听错）
```

**需要 HTTPS**（`getUserMedia` 要安全上下文），localhost 除外。

---

## 坑（每条都真实踩过）

### 1. 浏览器自带的语音识别，国内用不了
Chrome 的 Web Speech API（`webkitSpeechRecognition`）**走谷歌服务器，国内被墙**。
最初图省事用了它，结果通话永远卡在"在听你说……"。
→ 本模组走**录音 + MiMo ASR**，不碰它。

> 通用教训：国内产品凡"浏览器自带的云能力"，先怀疑是不是走谷歌。

### 2. MiMo 的 ASR/TTS 不在常规位置
`/v1/audio/speech`、`/v1/audio/transcriptions` 都是 **404**。两者都走 `/v1/chat/completions`：
- **TTS**：待读文本放 **assistant** 消息，音频在 `delta.audio.data`
- **ASR**：音频放 **user** 消息的 `input_audio`

`server/mimo.ts` 已经封好，不用自己试。

### 3. 延迟的真凶是提示词，不是模型
完整系统提示词几万字时，MiMo 冷缓存要重算，**首句能到 10-15 秒**。三件套缺一不可：
1. **精简提示词**（语音场景砍掉用不上的长尾）
2. **关掉思考**：`thinking: {type:"disabled"}`
3. **句级流式朗读**（本模组已内置）

模型选 `mimo-v2.5` 而不是 `pro`：实测 pro 解码 ~7 tok/s、首句 2.7s；v2.5 26 tok/s、首句 1.4s，口语短回答质量不掉。

**基线**：服务器侧量，首字 0.6–1.0s。偶发 3s+ 是网关波动。
> 量延迟必须在服务器上量。本地打公网含跨境往返（+3s），量的是假象。

### 4. 只在"听"阶段开麦
思考/说话时**必须关麦**，否则会录进自己的声音（回声、自问自答）。
代价：没有"抢话打断"。补偿：`call.interrupt()` 手动打断。

### 5. 重入和挂断竞态（模组已处理）
- 双击开始/回听撞车 → 重复开麦、**MediaStream 泄漏、麦克风常亮**。用同步门闩挡。
- `getUserMedia` 授权期间挂断 → 授权回来后采集照常启动，**挂断了还在发消息**。用 stale 检查丢弃。

### 6. TTS 流式收到 `[DONE]` 要立刻收尾
MiMo 发完不一定关连接，死等 socket 关闭会把响应挂到超时。

### 7. 若接了"读用户资料"的能力（grounding）
- 检索超时必须**硬竞速**（`Promise.race`）。只用 `AbortController` 掐不断已发出的请求，
  实测能把首字拖到 14 秒。
- **必须按用户隔离**：一把全局 key 去读/写"某个人的"数据，等于所有访客都在读那个人的隐私。
  这个错我犯过，是真实泄露。作用域在服务端强制，默认关闭（fail-closed）。

---

## 依赖

`recorder.ts` / `speechQueue.ts` **零依赖**（纯 Web API），直接拷也能用。
`useVoiceCall.ts` 需要 React 18+。服务端需要 Node 18+（用到 fetch/ReadableStream）。

## 浏览器要求

Chrome / Edge / Safari 14+。需要 `getUserMedia` + `AudioContext`，
用 `voiceCallSupported()` 做特性检测，不支持时降级到打字。
