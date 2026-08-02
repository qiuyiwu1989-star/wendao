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
