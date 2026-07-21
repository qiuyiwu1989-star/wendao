import { Pool } from "pg";

// 造物中台共享 PG（zhongtai_app）连接池。共享库，池子给小（文档铁律 5-10）。
// DATABASE_URL 未配置时为 null —— 云端历史相关接口据此返回未启用，不影响其余。
let pool: Pool | null = null;
let inited = false;

export function getPool(): Pool | null {
  if (inited) return pool;
  inited = true;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  pool = new Pool({ connectionString: url, max: 6, idleTimeoutMillis: 30_000 });
  pool.on("error", (e) => console.error("[db] pool error:", e.message));
  return pool;
}
