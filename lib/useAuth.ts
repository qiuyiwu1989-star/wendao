"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, authEnabled } from "@/lib/supabase";

export type AuthState = {
  enabled: boolean;
  ready: boolean;
  userId: string | null;
  email: string | null;
  token: string | null;
  signIn: (email: string, password: string) => Promise<string | null>; // 返回错误文案或 null
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "邮箱或密码不对";
  if (m.includes("already registered") || m.includes("already been"))
    return "这个邮箱已经注册过了，直接登录";
  if (m.includes("password")) return "密码至少 6 位";
  if (m.includes("email")) return "邮箱格式不对";
  return "出了点问题，稍后再试";
}

export function useAuth(): AuthState {
  const [ready, setReady] = useState(!authEnabled);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      setUserId(s?.user?.id ?? null);
      setEmail(s?.user?.email ?? null);
      setToken(s?.access_token ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setUserId(s?.user?.id ?? null);
      setEmail(s?.user?.email ?? null);
      setToken(s?.access_token ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (em: string, pw: string) => {
    if (!supabase) return "未启用";
    const { error } = await supabase.auth.signInWithPassword({
      email: em.trim(),
      password: pw,
    });
    return error ? friendly(error.message) : null;
  }, []);

  const signUp = useCallback(async (em: string, pw: string) => {
    if (!supabase) return "未启用";
    const { error } = await supabase.auth.signUp({
      email: em.trim(),
      password: pw,
    });
    return error ? friendly(error.message) : null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  return {
    enabled: authEnabled,
    ready,
    userId,
    email,
    token,
    signIn,
    signUp,
    signOut,
  };
}
