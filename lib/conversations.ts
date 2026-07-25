const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const URL_ = `${BASE}/api/conversations`;

export type Msg = { role: "user" | "assistant"; content: string };
export type ConvMeta = { id: string; title: string; updated_at: string };
export type ConvFull = { id: string; title: string; messages: Msg[] };

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export async function listConversations(token: string): Promise<ConvMeta[]> {
  try {
    const r = await fetch(URL_, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return [];
    const j = (await r.json()) as { conversations?: ConvMeta[] };
    return j.conversations || [];
  } catch {
    return [];
  }
}

export async function loadConversation(
  token: string,
  id: string
): Promise<ConvFull | null> {
  try {
    const r = await fetch(`${URL_}?id=${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { conversation?: ConvFull };
    return j.conversation || null;
  } catch {
    return null;
  }
}

export async function saveConversation(
  token: string,
  body: { id?: string | null; messages: Msg[]; title?: string }
): Promise<string | null> {
  try {
    const r = await fetch(URL_, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { id?: string };
    return j.id || null;
  } catch {
    return null;
  }
}

export async function deleteConversation(
  token: string,
  id: string
): Promise<boolean> {
  try {
    const r = await fetch(`${URL_}?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}
