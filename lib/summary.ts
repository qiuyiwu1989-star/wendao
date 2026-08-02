// 思考小结：一场对话结束时，把长出来的东西固化成「判断」。
// 既是用户能带走的东西，也是将来汇入深脑的弹药。

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const SUMMARY_URL = `${BASE}/api/summary`;
export const SUMMARY_STORE = "wendao.summaries.v1";

export type Judgment = { type: string; text: string; basis?: string };
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
