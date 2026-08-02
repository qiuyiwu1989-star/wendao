import { createClient } from "@supabase/supabase-js";

// 服务端：校验前端带来的深脑 Supabase 登录 token，取出用户 id。
// 用 supabase.auth.getUser(token) 走 /auth/v1/user 验签（server→Supabase 同机，快），
// 不需要在本服务持有 JWT_SECRET。失败返回 null。

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h && h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

export async function getUser(
  req: Request
): Promise<{ id: string; email: string | null } | null> {
  const token = bearer(req);
  if (!token || !url || !anon) return null;
  try {
    const sb = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

export async function getUserId(req: Request): Promise<string | null> {
  return (await getUser(req))?.id ?? null;
}
