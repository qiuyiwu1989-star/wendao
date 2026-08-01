import type { Metadata } from "next";
import {
  ArrowLeft,
  Compass,
  Landmark,
  MessageCircle,
  Repeat,
  Scale,
  Search,
  Swords,
  Waypoints,
} from "lucide-react";

export const metadata: Metadata = {
  title: "关于问道 · 方法",
  description:
    "问道是深脑（DeepBrain）的对话思考层——不给答案，用「逼×化」的引导带你把问题想清楚。",
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

const MOVES: { name: string; when: string; line: string }[] = [
  { name: "叩两端", when: "立场模糊", line: "往极端想：完全 A 会怎样？完全 B 呢？你其实站哪？" },
  { name: "挖假设", when: "有隐含前提", line: "你这话其实默认了 X 成立——这个真的稳吗？" },
  { name: "上梯", when: "停在表层解法", line: "退一步，你要这个，是为了更底下的什么？" },
  { name: "下梯", when: "回答含糊", line: "具体点——'差不多'是几分？哪一件事？" },
  { name: "照镜", when: "出现矛盾", line: "你上句说想稳，这句说想赌——自己听出来了吗？" },
  { name: "换位", when: "关系冲突", line: "切到对方，他眼里这事长什么样？" },
  { name: "拉时间", when: "当下焦虑", line: "三年后回头看，今天这纠结还算事吗？" },
  { name: "反证", when: "过度乐观", line: "怎样操作，能保证这事一定砸？" },
  { name: "破框", when: "钻死胡同", line: "如果这问题根本不需要解决呢？" },
  { name: "留白", when: "将启未启", line: "……你先说。（不急着接）" },
  { name: "逼落地", when: "想清楚了", line: "那明天醒来，第一个动作是什么？" },
];

const SIGNALS: { sig: string; mine: string; act: string }[] = [
  { sig: "绝对词", mine: "一定 / 从来 / 必须 / 大家都", act: "挖假设" },
  { sig: "含糊词", mine: "感觉 / 差不多 / 还行 / 看情况", act: "下梯逼具体" },
  { sig: "情绪词", mine: "烦 / 怕 / 累 / 不甘", act: "先接住，再问真正怕什么" },
  { sig: "前后矛盾", mine: "两个诉求在打架", act: "照镜" },
  { sig: "回避岔开", mine: "这里最痛所以躲", act: "留白或温和逼回" },
  { sig: "能量突变", mine: "突然话多 / 语速快", act: "顺势深挖，别打断" },
];

const SPLIT: { layer: string; ratio: string; owner: string }[] = [
  { layer: "认知 · 怎么看", ratio: "华3 : 西7", owner: "西方 · 拆与验" },
  { layer: "决策 · 怎么选", ratio: "华3 : 西7", owner: "西方 · 算" },
  { layer: "风险 · 怎么防", ratio: "华4 : 西6", owner: "西方 · 防" },
  { layer: "系统 · 看整体", ratio: "华0 : 西8", owner: "西方 · 统" },
  { layer: "行动 · 怎么做", ratio: "华5 : 西5", owner: "平手" },
  { layer: "关系 · 怎么看人", ratio: "华7 : 西3", owner: "华夏 · 人" },
  { layer: "时间 · 看时机", ratio: "华6 : 西4", owner: "华夏 · 时" },
];

export default function About() {
  return (
    <main className="doc">
      <nav className="doc-nav">
        <a className="doc-back" href={`${BASE}/`}>
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>回到对话</span>
        </a>
        <a className="doc-navbrand" href={`${BASE}/intro`} style={{ textDecoration: "none" }}>
          问道是什么 →
        </a>
      </nav>

      <header className="doc-hero">
        <div className="doc-mark">
          <Compass size={26} strokeWidth={1.5} />
        </div>
        <h1 className="doc-title">问道</h1>
        <p className="doc-tag">不给答案，带你把问题想清楚。</p>
        <p className="doc-lead">
          问道是「深脑（DeepBrain）」的<em>对话思考层</em>
          ——把你的第二大脑，从一个存东西的"仓库"，变成一个会陪你想事情的"头脑"。你用说话来想，每一次对话，既调用你的大脑，也在喂养它。
        </p>
      </header>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Repeat size={15} strokeWidth={1.9} />
          它是什么
        </div>
        <h2 className="doc-h">和深脑，是一个闭环飞轮</h2>
        <p className="doc-p">
          问道和深脑不是一条直线上的上下游，而是一个转圈的飞轮。一次对话 = 转一圈：
          <em> 调背景 → 一起想 → 存沉淀</em>。
        </p>
        <div className="doc-two">
          <div className="doc-card">
            <div className="doc-card-h">向下取 · 调背景</div>
            <p>
              对话时从深脑调用你的过往会议、目标、判断、价值观——于是问道问出的是"懂你的"问题，而不是在真空里空谈。
            </p>
          </div>
          <div className="doc-card">
            <div className="doc-card-h">向上喂 · 存沉淀</div>
            <p>
              对话里长出来的意图、决定、悬而未决的问题、新概念，回写进深脑。思考即积累，你越用，它越懂你。
            </p>
          </div>
        </div>
        <p className="doc-p doc-north">
          <strong>北极星：让你更会想，而不是替你想好。</strong>
          当所有 AI 都抢着给你答案，稀缺的变成"你自己会不会想"。单次决策只是钩子，长期把你变成更好的思考者，才是问道的价值——这也是它唯一主动<em>拒绝替你思考</em>的原因。
        </p>
      </section>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Scale size={15} strokeWidth={1.9} />
          方法论宪法
        </div>
        <h2 className="doc-h">一件事：逼 × 化</h2>
        <p className="doc-p">
          问道内含 68 个思维元件，华夏 28、西方 40。真正有意义的不是数量，是分布——两种文明的思维基因，各占一片山头。
        </p>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th>层</th>
                <th>华 : 西</th>
                <th>主场</th>
              </tr>
            </thead>
            <tbody>
              {SPLIT.map((r) => (
                <tr key={r.layer}>
                  <td>{r.layer}</td>
                  <td className="doc-mono">{r.ratio}</td>
                  <td>{r.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="doc-two">
          <div className="doc-card doc-card-west">
            <div className="doc-card-h">西方负责「逼」</div>
            <p>把问题逼到墙角——拆结构、挖假设、算后果、验逻辑。用在你"想不清楚"的时候。</p>
          </div>
          <div className="doc-card doc-card-east">
            <div className="doc-card-h">华夏负责「化」</div>
            <p>给一个转身的空间——择时机、看人心、破执念、留余地。用在你"想不开"的时候。</p>
          </div>
        </div>
        <p className="doc-p">
          一场好的对话，就是「逼」与「化」的交替：西方把问题逼实，东方在卡死时给一个转身。
        </p>
      </section>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Landmark size={15} strokeWidth={1.9} />
          两个老祖宗
        </div>
        <h2 className="doc-h">"不给答案"，自有其根</h2>
        <div className="doc-roots">
          <div className="doc-root">
            <span className="doc-root-name">苏格拉底</span>
            <span className="doc-root-desc">诘问 + 助产术：用追问逼出你信念里的矛盾，再帮你把自己的想法接生出来。→ 逼</span>
          </div>
          <div className="doc-root">
            <span className="doc-root-name">孔子</span>
            <span className="doc-root-desc">不愤不启，不悱不发；举一隅，要你还三隅。只在你快憋出来时才点。→ 择时</span>
          </div>
          <div className="doc-root">
            <span className="doc-root-name">禅宗</span>
            <span className="doc-root-desc">机锋公案：一句悖论打破概念固着，逼一个顿悟。→ 破框</span>
          </div>
          <div className="doc-root">
            <span className="doc-root-name">道家</span>
            <span className="doc-root-desc">行不言之教：有时最强的一招是沉默，让你自己走到。→ 留白</span>
          </div>
        </div>
      </section>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Swords size={15} strokeWidth={1.9} />
          怎么引导
        </div>
        <h2 className="doc-h">招式表 · 一回合只出一招</h2>
        <div className="doc-moves">
          {MOVES.map((m) => (
            <div className="doc-move" key={m.name}>
              <div className="doc-move-top">
                <span className="doc-move-name">{m.name}</span>
                <span className="doc-move-when">{m.when}</span>
              </div>
              <p className="doc-move-line">“{m.line}”</p>
            </div>
          ))}
        </div>
      </section>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Search size={15} strokeWidth={1.9} />
          怎么挖掘
        </div>
        <h2 className="doc-h">追着"卡"走，不追着"信息"走</h2>
        <p className="doc-p">
          问道的活脑子：听你刚说的话里有没有"卡"——哪里有卡，哪里就是矿。听到这些信号，就往对应方向下一铲。
        </p>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th>信号</th>
                <th>下面埋着</th>
                <th>下一铲</th>
              </tr>
            </thead>
            <tbody>
              {SIGNALS.map((s) => (
                <tr key={s.sig}>
                  <td className="doc-strong">{s.sig}</td>
                  <td>{s.mine}</td>
                  <td>{s.act}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-section">
        <div className="doc-eyebrow">
          <Waypoints size={15} strokeWidth={1.9} />
          怎么推进
        </div>
        <h2 className="doc-h">螺旋下沉 · 一层一停</h2>
        <ol className="doc-flow">
          <li><span>接住</span>安住情绪、建立信任。</li>
          <li><span>找缝</span>定位真问题——不是你报的那个。</li>
          <li><span>下沉</span>出一招 → 读信号 → 再选一招，循环。</li>
          <li><span>照见</span>让你自己看见，不是我告诉你。</li>
          <li><span>收或留</span>逼落地给出口，或留白留余韵。</li>
        </ol>
        <p className="doc-p doc-muted">
          深度不是一次给够，是一来一回磨出来的。所以问道说得短——短不是浅，是逼你参与。
        </p>
      </section>

      <div className="doc-cta">
        <a className="doc-cta-btn" href={`${BASE}/`}>
          <MessageCircle size={18} strokeWidth={1.8} />
          开始一场对话
        </a>
      </div>

      <footer className="doc-foot">问道 · 深脑（DeepBrain）出品</footer>
    </main>
  );
}
