# 问道 (Deep Thinker)

**不给答案，带你把问题想清楚。**

在线体验 → **[wendao.zaowuyun.com](https://wendao.zaowuyun.com)**（打开麦克风，点电话键可通话）

问道是一个**独立的语音对话思维教练**——你可以**说**给它听（麦克风语音输入），它用**短而准**的一两句话点醒你、把问题踢回给你，并**把回答读出来**（流式 TTS 语音），像面对面聊天，而不是丢给你一篇长报告。

它是「深脑（DeepBrain）」的下游应用之一：一个可随时对话的深度思考智能体。对话与语音都由**小米 MiMo** 网关驱动。

- **[`COUNTERPARTY.md`](COUNTERPARTY.md)** —— 接上第二大脑后它该是什么（产品方向的锚，有牙齿）
- [`METHODOLOGY.md`](METHODOLOGY.md) —— 怎么跟人对话（逼×化 / 招式 / 挖掘引擎）
- [`docs/pipeline.html`](docs/pipeline.html) —— 推理管线单页说明（双击可开）
- 网页版：`/` 项目介绍 · `/about` 方法论 · `/chat` 试用

---

## 它由两部分组成

| 部分 | 是什么 | 在哪 |
|------|--------|------|
| **应用（App）** | Next.js 聊天 Web App，流式对话界面 | `app/` `lib/` |
| **大脑（Brain）** | 问道的完整能力定义：68 个思维元件 + 三种参与模式 + 反机械化约束 | `SKILL.md` `methods/` |

**单一事实源**：App 在服务端把 `SKILL.md` + `methods/*.md` 原样加载进系统提示词（见 [`lib/persona.ts`](lib/persona.ts)）。改技能文件 = 改问道的思考方式，**不需要动代码**。

---

## 核心能力

| 特性 | 说明 |
|------|------|
| **语音对话** | 说给它听（麦克风输入，说完自动发送）+ 回答流式朗读（MiMo TTS，默认男声「苏打」），可静音、可「朗读」重听 |
| **短而准** | 默认口语化、2-4 句、一次推进一步，把球踢回给你——不甩长篇大论 |
| **对话引导引擎** | 「逼 × 化」宪法 + 11 招引导动作库 + 六信号挖掘引擎（追着"卡"走）+ 螺旋下沉流程。看人下菜，不套模板。详见 [`METHODOLOGY.md`](METHODOLOGY.md) |
| **68 个思维元件** | 7 层结构：认知 / 决策 / 行动 / 关系 / 时间 / 风险 / 系统 |
| **中西融合** | 华夏 28 + 西方 40。西方长于「拆算防统」，华夏长于「人时行」——一场对话是两者交替 |
| **教练式交互** | 不给答案，用问题驱动思考。方法隐性使用，永远不报术语名 |
| **反机械化** | 表达约束 / 叙事弧线多样化 / 同类方法去重 / 长对话收束 |

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置密钥（复制模板后填入 MiMo 网关 key）
cp .env.example .env.local
#   在 .env.local 里填 LLM_API_KEY=tp-...

# 3. 本地开发
npm run dev
#   打开 http://localhost:3200

# 生产构建
npm run build && npm run start
```

## 环境变量

见 [`.env.example`](.env.example)。关键项：

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `LLM_API_KEY` | 是 | — | MiMo 网关 key（对话 + TTS 共用），只在服务端 |
| `LLM_BASE` | 否 | `https://token-plan-cn.xiaomimimo.com` | 网关根地址 |
| `WENDAO_MODEL` | 否 | `mimo-v2.5-pro` | 对话模型（`mimo-v2.5` 更快） |
| `WENDAO_TTS_MODEL` | 否 | `mimo-v2.5-tts` | 语音合成模型 |
| `WENDAO_TTS_VOICE` | 否 | `苏打` | 音色（男：苏打/白桦，女：冰糖/茉莉…） |
| `WENDAO_MAX_TOKENS` | 否 | `1024` | 含模型思考，留足余量 |
| `BASE_PATH` | 否 | — | 子路径部署（如 `/wendao`）时设置 |

---

## 架构

```
浏览器（app/page.tsx）
   │  语音输入：Web Speech API（麦克风 → 文字）
   │  ① POST /api/chat  ← 流式 text/plain（逐字显示）
   │  ② 收完后 POST /api/tts，流式 PCM16 边收边放（lib/audioStream.ts）
   ▼
app/api/chat/route.ts   ← 服务端持有 key，MiMo /anthropic 流式对话
app/api/tts/route.ts    ← MiMo TTS：assistant 消息=待读文本；流式转发 pcm16，
                          降级返回整段 wav
app/api/health/route.ts ← 健康检查（部署/watchdog 用）
   ▼
lib/persona.ts          ← 加载 SKILL.md + methods/*.md 组装系统提示词
```

- 密钥只在服务端，前端拿不到（对话与 TTS 共用一个 MiMo key）。
- 系统提示词很长且每次相同，MiMo 网关自动 **prompt cache** 降本提速。
- TTS 首字节即开声（流式 pcm16）；Web Audio 不可用时自动回落整段 wav。TTS 前剥掉 Markdown/emoji。
- 语音输入用浏览器原生识别，需 HTTPS + Chrome/Edge。
- v1 无数据库：对话历史与语音开关存浏览器 `localStorage`。

部署（与 shennao 同机共存）见 [`DEPLOY.md`](DEPLOY.md)。

---

## 作为技能复用

问道的「大脑」仍是一份可被其他 Agent 调用的技能。集成到 OpenClaw：

```bash
git clone https://github.com/qiuyiwu1989-star/openclaw-wendao.git ~/.openclaw/shared-skills/问道
# 在 Agent SKILL.md 中引用："深度分析/帮我分析" → spawn 问道
```

---

## 许可证

MIT License

---

*不给答案，带你把问题想清楚。*
