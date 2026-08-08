import { getPool } from "@/lib/db";

// 催账（COUNTERPARTY.md 职能②）：判断有保质期。
// 用户说过"这个假设我得验一下"——到期了就该被翻出来问。
// 不催账的账本没有意义，所以这一层的存在就是为了让账主动找上门。

export type DueBet = { id: string; claim: string; basis: string; days: number };

/** 取该用户已到期、还挂着的账（最该问的在前） */
export async function fetchDueBets(userId: string, limit = 3): Promise<DueBet[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const r = await pool.query(
      `select id, claim, coalesce(basis,'') as basis,
              greatest(0, extract(day from (now() - due_at))::int) as days
         from public.wendao_bets
        where user_id = $1 and status = 'open' and due_at <= now()
        order by due_at asc
        limit $2`,
      [userId, limit]
    );
    return r.rows as DueBet[];
  } catch (e) {
    console.error("[bets] fetchDue", e);
    return []; // 催账是加分项，取不到就算了，绝不拖垮对话
  }
}

/** 把到期的账拼成提示词片段，让问道开口就问 */
export function debtBlock(bets: DueBet[]): string {
  const lines = bets
    .map((b) => {
      const when = b.days > 0 ? `（已经过去 ${b.days} 天）` : "（今天到期）";
      const q = b.basis ? `　他当时的原话："${b.basis}"` : "";
      return `- ${b.claim}${when}${q ? "\n" + q : ""}`;
    })
    .join("\n");

  return `

---

# 有几笔账到期了（来自他过去的对话）

下面是他之前说过"要去验证"、但还没结账的假设：

${lines}

**这一轮你要做的：**
- 在回应他当下这句话之前或之后，**挑最相关的一笔问出来**——"上次你说这事成立的前提是 X，你说要去验。验了吗？"
- 只挑一笔，别把账单一次全甩出来。
- 如果他这句话跟所有账都无关，也可以先接住他，等这轮聊完再提。
- 用他自己的原话去问，力量比你自己的措辞大得多。
- **不要说"系统显示""根据记录"**，就像一个记性好的朋友那样自然地提起。`;
}
