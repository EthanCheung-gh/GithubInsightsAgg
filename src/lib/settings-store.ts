import { get, run } from '@/lib/db';

/**
 * 应用级键值设置存储（`app_settings` 表）。
 *
 * 安全约定：
 * - 这里存放的 GitHub Token **是明文**（SQLite 本地库，无加解密），
 *   因此本模块只负责读写，不做任何日志输出；展示层必须用 `maskToken()`。
 * - 所有 SQL 均为参数化语句，禁止拼接值。
 */

/** GitHub Token 在 `app_settings` 中的键名。 */
export const GITHUB_TOKEN_KEY = 'github_token';

/** 库中存留的 Token 及其写入时间（ISO 8601）。 */
export interface StoredTokenInfo {
  token: string;
  updatedAt: string;
}

interface SettingRow {
  value: string;
  updated_at: string;
}

/** 读取任意设置项；不存在返回 null。 */
export function getSetting(key: string): string | null {
  const row = get<SettingRow>('SELECT value, updated_at FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

/** upsert 写入设置项，同时刷新 `updated_at`。 */
export function setSetting(key: string, value: string): void {
  run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, new Date().toISOString()],
  );
}

/** 删除设置项；返回是否真的删掉了一行。 */
export function deleteSetting(key: string): boolean {
  return run('DELETE FROM app_settings WHERE key = ?', [key]).changes > 0;
}

/** 读取应用内保存的 GitHub Token；未设置或为空串时返回 null。 */
export function getStoredToken(): StoredTokenInfo | null {
  const row = get<SettingRow>(
    'SELECT value, updated_at FROM app_settings WHERE key = ?',
    [GITHUB_TOKEN_KEY],
  );
  if (!row) return null;
  const token = row.value.trim();
  if (!token) return null;
  return { token, updatedAt: row.updated_at };
}

/** 保存 GitHub Token（覆盖旧值），返回写入后的记录。 */
export function setStoredToken(token: string): StoredTokenInfo {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('token is empty');
  const updatedAt = new Date().toISOString();
  run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [GITHUB_TOKEN_KEY, trimmed, updatedAt],
  );
  return { token: trimmed, updatedAt };
}

/** 清除应用内保存的 GitHub Token；返回是否真的删掉了一行。 */
export function clearStoredToken(): boolean {
  return deleteSetting(GITHUB_TOKEN_KEY);
}

/**
 * 把 Token 脱敏成可安全展示的形式。
 *
 * - 长度 <= 8：固定 8 个 `*`（不泄露长度）；
 * - 其他：保留前 4 与后 4，中间用单字符省略号，如 `ghp_…mnop`。
 *
 * 任何对外返回 Token 的接口都必须经过这里，**绝不可返回完整 Token**。
 */
export function maskToken(token: string): string {
  const raw = token ?? '';
  if (raw.length <= 8) return '*'.repeat(8);
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}
