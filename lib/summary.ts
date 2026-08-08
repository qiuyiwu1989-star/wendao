// 思考小结：一场对话结束时，把长出来的东西固化成「判断」。
// 既是用户能带走的东西，也是将来汇入深脑的弹药。

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const SUMMARY_URL = `${BASE}/api/summary`;
export const SUMMARY_STORE = "wendao.summaries.v1";

export type Judgment = {
  type: string;
  text: string;
  basis?: string;
  /** 仅「还在赌」：多少天内该去验证 */
  checkDays?: number;
};
export type Summary = {
  title: string;
  judgments: Judgment[];
  takeaway: string;
};
export type StoredSummary = Summary & { id: string; at: number };

export async function extractSummary(
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<Summary | null> {
  try {
    const res = await fetch(SUMMARY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; summary?: Summary };
    return j.ok && j.summary ? j.summary : null;
  } catch {
    return null;
  }
}

export function loadSummaries(): StoredSummary[] {
  try {
    const raw = localStorage.getItem(SUMMARY_STORE);
    if (!raw) return [];
    const arr = JSON.parse(raw) as StoredSummary[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveSummary(s: Summary): StoredSummary {
  const stored: StoredSummary = {
    ...s,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  };
  try {
    const all = [stored, ...loadSummaries()].slice(0, 100);
    localStorage.setItem(SUMMARY_STORE, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  return stored;
}

export function deleteSummary(id: string) {
  try {
    localStorage.setItem(
      SUMMARY_STORE,
      JSON.stringify(loadSummaries().filter((s) => s.id !== id))
    );
  } catch {
    /* ignore */
  }
}

// ---------- 云端同步（登录后把本地攒的小结带上去） ----------
const SUMMARIES_URL = `${BASE}/api/summaries`;

/** 把本地小结批量同步到云端（幂等，服务端按 local_id 去重）。返回新入库条数 */
export async function syncSummaries(
  token: string,
  items: StoredSummary[]
): Promise<number> {
  if (!items.length) return 0;
  try {
    const res = await fetch(SUMMARIES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        items: items.map((s) => ({
          title: s.title,
          judgments: s.judgments,
          takeaway: s.takeaway,
          local_id: s.id,
        })),
      }),
    });
    if (!res.ok) return 0;
    const j = (await res.json()) as { synced?: number };
    return j.synced || 0;
  } catch {
    return 0;
  }
}

// ---------- 账本（COUNTERPARTY.md 职能② 催账）----------
const BETS_URL = `${BASE}/api/bets`;

export type Bet = {
  id: string;
  claim: string;
  basis: string;
  from_title: string;
  due_at: string;
  overdue: boolean;
};

/** 小结里的「还在赌」自动记进账本（幂等，服务端按 local_id 去重） */
export async function recordBets(
  token: string,
  summary: StoredSummary
): Promise<number> {
  const bets = summary.judgments.filter((j) => j.type === "还在赌");
  if (!bets.length) return 0;
  try {
    const res = await fetch(BETS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items: bets.map((b, i) => ({
          claim: b.text,
          basis: b.basis || "",
          checkDays: b.checkDays ?? 14,
          fromTitle: summary.title,
          local_id: `${summary.id}-${i}`,
        })),
      }),
    });
    if (!res.ok) return 0;
    return ((await res.json()) as { added?: number }).added || 0;
  } catch {
    return 0;
  }
}

/** 各状态的账目计数。broken = 被推翻的判断数，是问道唯一在乎的指标 */
export type BetStats = { open: number; held: number; broken: number; dropped: number };

export const EMPTY_BET_STATS: BetStats = { open: 0, held: 0, broken: 0, dropped: 0 };

/**
 * 拉账本：既要挂着的账，也要各状态计数。
 * 计数一并返回而不是另开一个接口——它和列表是同一次请求里的同一份事实，
 * 分两次拉会出现"列表更新了、数字还是旧的"这种自相矛盾的界面。
 */
export async function listBets(
  token: string
): Promise<{ bets: Bet[]; stats: BetStats }> {
  try {
    const res = await fetch(BETS_URL, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return { bets: [], stats: { ...EMPTY_BET_STATS } };
    const j = (await res.json()) as { bets?: Bet[]; stats?: Partial<BetStats> };
    return {
      bets: j.bets || [],
      stats: { ...EMPTY_BET_STATS, ...(j.stats || {}) },
    };
  } catch {
    return { bets: [], stats: { ...EMPTY_BET_STATS } };
  }
}

/** 结账：held=验了成立 / broken=验了不成立 / dropped=不验了 */
export async function settleBet(
  token: string,
  id: string,
  status: "held" | "broken" | "dropped"
): Promise<boolean> {
  try {
    const res = await fetch(BETS_URL, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- 思维画像（COUNTERPARTY.md 职能③ 照出盲区）----------
const PROFILE_URL = `${BASE}/api/profile`;

export type Profile = {
  dimensions: {
    strong: { dim: string; claim: string; evidence: string }[];
    weak: { dim: string; claim: string; hint: string }[];
    probed: string[];
    /** 从没探过的维度——盲区本体 */
    unprobed: string[];
    next: { dim: string; how: string }[];
  };
  sessionsCount: number;
  updatedAt: string;
};

/**
 * 一场对话结束时，把这场的新证据并进画像（跨会话累积，服务端做增量合并）。
 * 带上小结的判断能显著提高质量——判断比逐字稿密度高。
 */
export async function updateProfileFromSession(
  token: string,
  messages: { role: "user" | "assistant"; content: string }[],
  judgments?: Judgment[]
): Promise<Profile | null> {
  try {
    const res = await fetch(PROFILE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages, judgments: judgments || [] }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; profile?: Profile };
    return j.ok && j.profile ? j.profile : null;
  } catch {
    return null;
  }
}

/** 我的画像；还没攒出来返回 null */
export async function getProfile(token: string): Promise<Profile | null> {
  try {
    const res = await fetch(PROFILE_URL, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return ((await res.json()) as { profile?: Profile | null }).profile || null;
  } catch {
    return null;
  }
}
