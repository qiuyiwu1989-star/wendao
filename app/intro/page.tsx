import type { Metadata } from "next";
import {
  ArrowRight,
  BookOpen,
  Brain,
  Compass,
  Github,
  Layers,
  MessageCircle,
  Mic,
  Phone,
  Repeat,
  ShieldCheck,
  Sparkles,
  Volume2,
  Waypoints,
} from "lucide-react";

export const metadata: Metadata = {
  title: "问道 · 项目介绍",
  description:
    "问道是一个语音对话思维教练：不给答案，用「逼 × 化」的引导带你把问题想清楚。深脑（DeepBrain）下游应用。",
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const REPO = "https://github.com/qiuyiwu1989-star/wendao";

const FEATURES = [
  {
    icon: Phone,
    title: "打电话一样地想事情",
    body: "点电话键进通话模式，说完停一下它就接话，说完又自动接着听。全程不用碰手机，像跟一个教练在打电话。",
  },
  {
    icon: Volume2,
    title: "边想边说，不用等",
    body: "回答一凑齐整句就开始朗读，不等整段生成完。你说完到听见第一声，热缓存下约 1.7 秒。",
  },
  {
    icon: Waypoints,
    title: "一次只推进一步",
    body: "不甩五千字大纲。挑最关键的一个点说透，然后把问题踢回给你——深度是一来一回磨出来的。",
  },
  {
    icon: ShieldCheck,
    title: "碰到真难受时，它先做人",
    body: "识别到严重痛苦，立刻停掉所有教练动作，接住你，并把国家心理援助热线递过去。安全压过一切规则。",
  },
];

const STACK = [
  { k: "对话", v: "小米 MiMo v2.5（Anthropic 兼容网关）" },
  { k: "语音合成", v: "mimo-v2.5-tts · 流式 PCM16 · 四种音色" },
  { k: "语音识别", v: "mimo-v2.5-asr（浏览器录音 + 静音检测）" },
  { k: "应用", v: "Next.js 14 · TypeScript · 零 emoji，lucide 图标" },
  { k: "账号 / 历史", v: "深脑 Supabase Auth + 造物中台共享 PG" },
  { k: "部署", v: "自有服务器 122 · nginx · pm2 · HTTPS" },
];

export default function Intro() {
  return (
    <main className="doc">
      <nav className="doc-nav">
        <a className="doc-back" href={`${BASE}/`}>
          <Compass size={16} strokeWidth={1.8} />
          <span>问道</span>
        </a>
        <span className="doc-navbrand">项目介绍</span>
      </nav>

      <header className="doc-hero">
        <div className="doc-mark">
          <Compass size={26} strokeWidth={1.5} />
        </div>
        <h1 className="doc-title">问道</h1>
        <p className="doc-tag">不给答案，带你把问题想清楚。</p>
        <p className="doc-lead">
          市面上的 AI 抢着替你把答案想好。问道反过来——它是一个
          <em>会说话的思维教练</em>
          ，用提问带你走一遍思考过程。你张嘴说，它开口问，一来一回，把那件想不通的事想到根上。
        </p>
        <div className="intro-cta-row">
          <a className="doc-cta-btn" href={`${BASE}/`}>
            <MessageCircle size={18} strokeWidth={1.8} />
            开始对话
          </a>
          <a className="intro-ghost" href={`${BASE}/about`}>
            <BookOpen size={16} strokeWidth={1.8} />
            方法论详解
          </a>
        </div>
      </header>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Sparkles size={15} strokeWidth={1.9} />
          它为什么反着做
        </div>
        <h2 className="doc-h">答案正在变便宜，会想才值钱</h2>
        <p className="doc-p">
          当所有产品都抢着给你结论，稀缺的东西变了——不是"拿到答案"，而是
          <em>你自己还会不会想</em>
          。一个总替你思考的工具，会让你越用越依赖它；问道要做的是反面：让你离开它的时候，也更会问自己问题。
        </p>
        <p className="doc-p doc-north">
          <strong>北极星：让你更会想，而不是替你想好。</strong>
          单次把一件事想清楚只是钩子，长期把你变成更好的思考者，才是问道存在的理由。
        </p>
      </section>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Mic size={15} strokeWidth={1.9} />
          怎么用
        </div>
        <h2 className="doc-h">四件它做得不太一样的事</h2>
        <div className="intro-grid">
          {FEATURES.map((f) => (
            <div className="intro-card" key={f.title}>
              <div className="intro-card-icon">
                <f.icon size={18} strokeWidth={1.7} />
              </div>
              <div className="intro-card-title">{f.title}</div>
              <p className="intro-card-body">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Layers size={15} strokeWidth={1.9} />
          脑子里装了什么
        </div>
        <h2 className="doc-h">68 个思维元件，中西各占一片山头</h2>
        <div className="intro-stats">
          <div className="intro-stat">
            <span className="intro-stat-n">68</span>
            <span className="intro-stat-l">思维元件</span>
          </div>
          <div className="intro-stat">
            <span className="intro-stat-n">28</span>
            <span className="intro-stat-l">华夏框架</span>
          </div>
          <div className="intro-stat">
            <span className="intro-stat-n">40</span>
            <span className="intro-stat-l">西方方法</span>
          </div>
          <div className="intro-stat">
            <span className="intro-stat-n">11</span>
            <span className="intro-stat-l">引导招式</span>
          </div>
        </div>
        <p className="doc-p">
          分布不是随机的：西方长于<em>拆算防统</em>
          ——第一性原理、二阶思维、反脆弱、系统杠杆；华夏长于
          <em>人时行</em>——己所不欲、法术势、天时、以退为进。
        </p>
        <div className="doc-two">
          <div className="doc-card doc-card-west">
            <div className="doc-card-h">西方负责「逼」</div>
            <p>把问题逼到墙角：挖假设、拆结构、算后果。你<b>想不清楚</b>时用。</p>
          </div>
          <div className="doc-card doc-card-east">
            <div className="doc-card-h">华夏负责「化」</div>
            <p>给一个转身的空间：拉时间、换位、留白。你<b>想不开</b>时用。</p>
          </div>
        </div>
        <p className="doc-p doc-muted">
          方法全部隐性使用——它永远不会跟你报术语名。想看完整的招式表和挖掘引擎，去
          <a href={`${BASE}/about`}> 方法论详解</a>。
        </p>
      </section>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Repeat size={15} strokeWidth={1.9} />
          它在哪个位置
        </div>
        <h2 className="doc-h">深脑的对话层</h2>
        <p className="doc-p">
          问道是「深脑（DeepBrain）」的下游应用。深脑是你的第二大脑，攒下判断与记忆；问道是它<em>会开口的那一面</em>
          ——你用说话来想，每一次对话既调用你的大脑，也在喂养它。
        </p>
        <ol className="doc-flow">
          <li>
            <span>向下取</span>对话时调你在深脑里的背景，问出"懂你的"问题。
          </li>
          <li>
            <span>一起想</span>用逼×化的引导，把这件事想到根上。
          </li>
          <li>
            <span>向上喂</span>长出的意图、判断、悬而未决的问题，回写进深脑。
          </li>
        </ol>
        <p className="doc-p doc-muted">
          一次对话 = 飞轮转一圈。越用，它越懂你怎么想事情。
        </p>
      </section>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Brain size={15} strokeWidth={1.9} />
          技术
        </div>
        <h2 className="doc-h">怎么搭的</h2>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <tbody>
              {STACK.map((s) => (
                <tr key={s.k}>
                  <td className="doc-strong">{s.k}</td>
                  <td>{s.v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="doc-p doc-muted">
          通话链路：浏览器录音（静音检测自动断句）→ 语音识别 → 对话生成（流式）→
          整句即合成朗读 → 播完自动接着听。密钥只在服务端，公开接口有限流护栏。
        </p>
      </section>

      <div className="doc-cta">
        <a className="doc-cta-btn" href={`${BASE}/`}>
          <MessageCircle size={18} strokeWidth={1.8} />
          去跟问道聊聊
          <ArrowRight size={16} strokeWidth={2} />
        </a>
        <div className="intro-repo">
          <a href={REPO} target="_blank" rel="noopener noreferrer">
            <Github size={15} strokeWidth={1.8} />
            源码开源在 GitHub
          </a>
        </div>
      </div>

      <footer className="doc-foot">问道 · 深脑（DeepBrain）出品</footer>
    </main>
  );
}
