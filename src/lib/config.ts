import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export interface AppConfig {
  databasePath: string;
  githubToken: string | null;
  tokenSource: 'env' | 'none';
  minIntervalMs: number;
  version: string;
  isBuildPhase(): boolean;
}

const DEFAULT_DATABASE_URL = 'file:./data/insights.db';
const DEFAULT_MIN_INTERVAL_MS = 80;
const APP_VERSION = '1.0.0';

function stripFileScheme(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('file:')) {
    value = value.slice('file:'.length);
    // file:///abs/path -> /abs/path
    if (value.startsWith('//')) value = value.slice(2);
  }
  return value.trim();
}

/** 把 DATABASE_URL 解析为基于 process.cwd() 的绝对路径，并确保父目录存在。 */
export function resolveDatabasePath(rawUrl?: string | null): string {
  const fromEnv = rawUrl === undefined || rawUrl === null ? '' : rawUrl;
  const pathPart = stripFileScheme(fromEnv) || stripFileScheme(DEFAULT_DATABASE_URL);
  const absolute = isAbsolute(pathPart) ? pathPart : resolve(process.cwd(), pathPart);
  try {
    mkdirSync(dirname(absolute), { recursive: true });
  } catch {
    // 目录创建失败时交给 sqlite 打开时抛出更具体的错误
  }
  return absolute;
}

function parseInterval(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MIN_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MIN_INTERVAL_MS;
  return Math.floor(parsed);
}

export function getConfig(): AppConfig {
  const env = process.env;
  const githubToken = env.GITHUB_TOKEN || env.GH_TOKEN || null;
  return {
    databasePath: resolveDatabasePath(env.DATABASE_URL),
    githubToken,
    tokenSource: githubToken ? 'env' : 'none',
    minIntervalMs: parseInterval(env.GITHUB_MIN_INTERVAL_MS),
    version: APP_VERSION,
    isBuildPhase: () => env.NEXT_PHASE === 'phase-production-build',
  };
}

export function resolveMode(token?: string | null): 'live' | 'demo' {
  return token ? 'live' : 'demo';
}
