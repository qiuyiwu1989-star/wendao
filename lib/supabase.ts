import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 浏览器端 Supabase 客户端（接深脑自托管 Supabase）。
// anon key 是公开设计（受 RLS 保护），随客户端下发没问题。
// 未配置（如本地无 key）时为 null —— UI 据此隐藏登录/云端历史，其余功能照常。

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: "wendao.auth",
        },
      })
    : null;

export const authEnabled = !!supabase;

export type ConversationRow = {
  id: string;
  user_id: string;
  title: string;
  messages: { role: "user" | "assistant"; content: string }[];
  created_at: string;
  updated_at: string;
};
