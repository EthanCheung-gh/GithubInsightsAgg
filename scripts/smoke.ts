/**
 * `pnpm smoke` —— 一条命令验证「建库 → 自举 → 指标 → 聚合 → HTTP」整条链路（WP7）。
 *
 * 数据库隔离：
 * - 环境里没有 DATABASE_URL，或它指向默认用户库 `data/insights.db` 时，
 *   本脚本强制切到 `file:./data/smoke.db`，并在启动时删掉上一次的 smoke 库文件。
 * - 显式传入其他库（例如 `DATABASE_URL=file:/tmp/wp7.db`）时尊重该取值且**不清库**，
 *   因为那可能是调用方准备好的数据。
 *
 * 因此绝不会污染用户的 `data/insights.db`。
 *
 * 退出码：任何 FAIL → 1；否则 0（SKIP 不算失败）。
 */

import { existsSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const SMOKE_DB_URL = 'file:./data/smoke.db';
const DEFAULT_USER_DB_URL = 'file:./data/insights.db';

const EXPECTED_TABLES = [
  'repos',
  'repo_stat_snapshots',
  'traffic_daily',
  'traffic_referrers',
  'traffic_paths',
  'contributors',
  'commit_days',
  'participation_weeks',
  'issue_pr_daily',
  'releases',
  'repo_languages',
  'community_profiles',
  'sync_runs',
];

const RANGE_DAYS = 30;

/* ------------------------------------------------------------------ */
/* 数据库隔离（必须在 import 任何 src/lib 之前完成）                    */
/* ------------------------------------------------------------------ */

function stripFileScheme(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('file:')) {
    value = value.slice('file:'.length);
    if (value.startsWith('//')) value = value.slice(2);
  }
  return value;
}

function absoluteDbPath(rawUrl: string): string {
  return resolvePath(process.cwd(), stripFileScheme(rawUrl));
}

interface DbSetup {
  url: string;
  file: string;
  managed: boolean;
  reason: string;
}

function configureDatabase(): DbSetup {
  const raw = (process.env.DATABASE_URL ?? '').trim();
  const smokeFile = absoluteDbPath(SMOKE_DB_URL);
  const userFile = absoluteDbPath(DEFAULT_USER_DB_URL);

  if (raw !== '') {
    const abs = absoluteDbPath(raw);
    const isUserDb = abs === userFile;
    const isSmokeDb = abs === smokeFile;
    if (!isUserDb && !isSmokeDb) {
      return { url: raw, file: abs, managed: false, reason: '沿用调用方提供的隔离库' };
    }
    return {
      url: SMOKE_DB_URL,
      file: smokeFile,
      managed: true,
      reason: isUserDb ? 'DATABASE_URL 指向默认用户库，已强制隔离' : '沿用 smoke 专用库',
    };
  }

  return { url: SMOKE_DB_URL, file: smokeFile, managed: true, reason: '未设置 DATABASE_URL' };
}

const dbSetup = configureDatabase();
process.env.DATABASE_URL = dbSetup.url;

function removeSmokeFiles(file: string): string[] {
  const removed: string[] = [];
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const candidate = `${file}${suffix}`;
    if (existsSync(candidate)) {
      rmSync(candidate, { force: true });
      removed.push(candidate);
    }
  }
  return removed;
}

const removedFiles = dbSetup.managed ? removeSmokeFiles(dbSetup.file) : [];

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

interface SmokeOptions {
  url: string | null;
  help: boolean;
  error: string | null;
}

function parseArgs(argv: string[]): SmokeOptions {
  const options: SmokeOptions = { url: null, help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const equalsAt = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const flag = equalsAt >= 0 ? raw.slice(0, equalsAt) : raw;
    const inlineValue = equalsAt >= 0 ? raw.slice(equalsAt + 1) : null;

    if (flag === '--help' || flag === '-h') {
      options.help = true;
      continue;
    }

    if (flag === '--url') {
      const value = inlineValue ?? argv[index + 1] ?? '';
      if (inlineValue === null) index += 1;
      const trimmed = value.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s]+$/.test(trimmed)) {
        options.error = `--url 需要 http(s) 地址，收到 "${value}"`;
        continue;
      }
      options.url = trimmed;
      continue;
    }

    if (options.error === null) {
      options.error = `未知参数: ${raw}`;
    }
  }
  return options;
}

function usage(): string {
  return [
    '用法: pnpm smoke [--url http://localhost:3000]',
    '',
    '选项:',
    '  --url <baseUrl>  额外校验 /api/health、/api/repos、/api/aggregate（需服务已启动）',
    '  -h, --help       显示本帮助',
    '',
    '不传 --url 时 HTTP 检查项标记 SKIP。',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

type Status = 'PASS' | 'FAIL' | 'SKIP';

interface Tally {
  passed: number;
  failed: number;
  skipped: number;
}

interface Outcome {
  status: Status;
  detail: string;
}

const tally: Tally = { passed: 0, failed: 0, skipped: 0 };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function report(index: number, label: string, outcome: Outcome): void {
  if (outcome.status === 'PASS') tally.passed += 1;
  else if (outcome.status === 'FAIL') tally.failed += 1;
  else tally.skipped += 1;
  const detail = outcome.detail.length > 0 ? `: ${outcome.detail}` : '';
  console.log(`${outcome.status} [${index}] ${label}${detail}`);
}

async function check(
  index: number,
  label: string,
  fn: () => Outcome | Promise<Outcome>,
): Promise<void> {
  let outcome: Outcome;
  try {
    outcome = await fn();
  } catch (error) {
    outcome = { status: 'FAIL', detail: `抛出异常 ${messageOf(error)}` };
  }
  report(index, label, outcome);
}

/* ------------------------------------------------------------------ */
/* 数值健康度扫描                                                      */
/* ------------------------------------------------------------------ */

function findNonFinite(value: unknown, path: string, seen: WeakSet<object>, out: string[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path || 'value'}=${String(value)}`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const target = value as object;
  if (seen.has(target)) return;
  seen.add(target);

  if (Array.isArray(value)) {
    value.forEach((item, index) => findNonFinite(item, `${path}[${index}]`, seen, out));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    findNonFinite(child, path.length > 0 ? `${path}.${key}` : key, seen, out);
  }
}

function nonFinitePaths(value: unknown): string[] {
  const out: string[] = [];
  findNonFinite(value, '', new WeakSet<object>(), out);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? (JSON.parse(text) as unknown) : null };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (options.error !== null) {
    console.log(`错误: ${options.error}`);
    console.log('');
    console.log(usage());
    return 2;
  }

  const db = await import('../src/lib/db');
  const { ensureBootstrapped } = await import('../src/lib/bootstrap');
  const { countRepos, insertRepo, listRepos } = await import('../src/lib/repo-store');
  const { computeAggregate, computeRepoMetrics } = await import('../src/lib/analytics');
  const { effectiveMode, syncRepo } = await import('../src/lib/sync');

  console.log(`smoke: database ${db.dbPath()} (${dbSetup.reason})`);
  if (removedFiles.length > 0) {
    console.log(`smoke: 已清理上一次的 smoke 库文件 ${removedFiles.join(', ')}`);
  }
  console.log(`smoke: mode ${effectiveMode()}`);
  console.log('');

  await check(1, '建表', () => {
    db.getDb();
    const rows = db.getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const names = rows.map((row) => row.name);
    const missing = EXPECTED_TABLES.filter((table) => !names.includes(table));
    if (missing.length > 0) {
      return { status: 'FAIL', detail: `缺少表 ${missing.join(', ')}（实际 ${names.length} 张）` };
    }
    if (names.length !== EXPECTED_TABLES.length) {
      return {
        status: 'FAIL',
        detail: `表数量 ${names.length}，期望 ${EXPECTED_TABLES.length}（${names.join(', ')}）`,
      };
    }
    return { status: 'PASS', detail: `${names.length} 张表` };
  });

  await check(2, '自举幂等', () => {
    const reposBefore = countRepos().total;
    const first = ensureBootstrapped();
    const second = ensureBootstrapped();
    if (second.seeded) {
      return { status: 'FAIL', detail: '第二次 ensureBootstrapped() 仍然 seeded=true（非幂等）' };
    }
    if (first.mode !== second.mode) {
      return { status: 'FAIL', detail: `两次调用的 mode 不一致: ${first.mode} -> ${second.mode}` };
    }
    const seededNote = first.seeded
      ? '首次写入演示数据'
      : first.mode === 'demo'
        ? '库中已有仓库，跳过 seed'
        : 'live 模式不自动创建仓库';
    return {
      status: 'PASS',
      detail: `seeded=${first.seeded}, mode=${first.mode}（调用前仓库数 ${reposBefore}，${seededNote}；第二次 seeded=${second.seeded}）`,
    };
  });

  // 隔离库为空时（live 模式下 bootstrap 不会自动建仓库）先落地一个 demo 仓库并同步一次，
  // 这样 `pnpm smoke` 在任意机器 / CI 上都能从零跑通「采集 -> 读库 -> 计算」全链路。
  if (countRepos().total === 0) {
    const placeholder = insertRepo({ owner: 'demo', name: 'aurora-ui' });
    const seeded = await syncRepo(placeholder, { days: RANGE_DAYS, trigger: 'cli' });
    console.log(
      `smoke: 隔离库为空，已写入 ${placeholder.fullName} 并执行一次同步（status=${seeded.status}, records=${seeded.recordsWritten}）`,
    );
  }

  await check(3, '仓库存在', () => {
    const counts = countRepos();
    if (counts.total <= 0) {
      return { status: 'FAIL', detail: 'repos 表为空，先运行 pnpm sync 或检查 mode' };
    }
    return { status: 'PASS', detail: `total=${counts.total}, enabled=${counts.enabled}` };
  });

  const allRepos = listRepos({ sort: 'stars' });
  const enabledRepos = allRepos.filter((repo) => repo.enabled);
  const targetRepo = enabledRepos[0] ?? allRepos[0] ?? null;

  await check(4, `指标计算 (${targetRepo?.fullName ?? '无仓库'}, ${RANGE_DAYS} 天)`, () => {
    if (targetRepo === null) {
      return { status: 'FAIL', detail: '没有可计算的仓库' };
    }
    const metrics = computeRepoMetrics(targetRepo, RANGE_DAYS);
    const problems: string[] = [];
    if (metrics.traffic.daily.length !== RANGE_DAYS) {
      problems.push(`traffic.daily.length=${metrics.traffic.daily.length}`);
    }
    if (metrics.activity.commits.length !== RANGE_DAYS) {
      problems.push(`activity.commits.length=${metrics.activity.commits.length}`);
    }
    if (metrics.issues.daily.length !== RANGE_DAYS) {
      problems.push(`issues.daily.length=${metrics.issues.daily.length}`);
    }
    if (metrics.overview.statsTrend.length !== RANGE_DAYS) {
      problems.push(`overview.statsTrend.length=${metrics.overview.statsTrend.length}`);
    }
    if (!(metrics.healthScore >= 0 && metrics.healthScore <= 100)) {
      problems.push(`healthScore=${String(metrics.healthScore)} 超出 0~100`);
    }
    if (!Array.isArray(metrics.insights)) {
      problems.push('insights 不是数组');
    }
    const bad = nonFinitePaths(metrics);
    if (bad.length > 0) {
      problems.push(`非有限数值 ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ` 等 ${bad.length} 处` : ''}`);
    }
    if (problems.length > 0) {
      return { status: 'FAIL', detail: problems.join('; ') };
    }
    return {
      status: 'PASS',
      detail: [
        '4 条序列均为 30 点',
        `healthScore=${metrics.healthScore}`,
        `insights=${metrics.insights.length} 条`,
        '无非有限数值',
      ].join(', '),
    };
  });

  await check(5, `聚合 (${allRepos.length} 个仓库, ${RANGE_DAYS} 天)`, () => {
    const aggregate = computeAggregate(allRepos, RANGE_DAYS);
    const problems: string[] = [];
    if (aggregate.overall.repos !== allRepos.length) {
      problems.push(`overall.repos=${aggregate.overall.repos}，期望 ${allRepos.length}`);
    }
    if (aggregate.trend.length !== RANGE_DAYS) {
      problems.push(`trend.length=${aggregate.trend.length}`);
    }
    if (aggregate.perRepo.length !== allRepos.length) {
      problems.push(`perRepo.length=${aggregate.perRepo.length}，期望 ${allRepos.length}`);
    }
    const bad = nonFinitePaths(aggregate);
    if (bad.length > 0) {
      problems.push(`非有限数值 ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ` 等 ${bad.length} 处` : ''}`);
    }
    if (problems.length > 0) {
      return { status: 'FAIL', detail: problems.join('; ') };
    }
    return {
      status: 'PASS',
      detail: `overall.repos=${aggregate.overall.repos}, trend=${aggregate.trend.length} 点, perRepo=${aggregate.perRepo.length}, insights=${aggregate.insights.length} 条`,
    };
  });

  await check(6, '空集边界', () => {
    const empty = computeAggregate([], RANGE_DAYS);
    if (empty.overall.repos !== 0) {
      return { status: 'FAIL', detail: `computeAggregate([]) 的 overall.repos=${empty.overall.repos}` };
    }
    if (empty.trend.length !== RANGE_DAYS) {
      return { status: 'FAIL', detail: `computeAggregate([]) 的 trend.length=${empty.trend.length}` };
    }
    if (empty.perRepo.length !== 0) {
      return { status: 'FAIL', detail: `computeAggregate([]) 的 perRepo.length=${empty.perRepo.length}` };
    }
    return { status: 'PASS', detail: '不抛错，overall.repos=0, trend=30 点, perRepo=0' };
  });

  await check(7, 'HTTP 端点', async () => {
    if (options.url === null) {
      return { status: 'SKIP', detail: '未传 --url（服务未启动时可忽略）' };
    }
    const base = options.url;
    const failures: string[] = [];
    const details: string[] = [];

    const health = await getJson(`${base}/api/health`);
    if (health.status !== 200) {
      failures.push(`/api/health 状态码 ${health.status}`);
    } else if (!isRecord(health.body) || health.body.ok !== true) {
      failures.push('/api/health 缺少 ok=true');
    } else {
      const body = health.body;
      if (body.mode !== 'live' && body.mode !== 'demo') failures.push('/api/health mode 非法');
      if (typeof body.dbPath !== 'string') failures.push('/api/health 缺少 dbPath');
      details.push(`health mode=${String(body.mode)}`);
    }

    const repos = await getJson(`${base}/api/repos`);
    if (repos.status !== 200) {
      failures.push(`/api/repos 状态码 ${repos.status}`);
    } else if (!isRecord(repos.body) || !Array.isArray(repos.body.repos)) {
      failures.push('/api/repos 缺少 repos 数组');
    } else {
      details.push(`repos=${repos.body.repos.length}`);
    }

    const aggregate = await getJson(`${base}/api/aggregate`);
    if (aggregate.status !== 200) {
      failures.push(`/api/aggregate 状态码 ${aggregate.status}`);
    } else if (!isRecord(aggregate.body) || !isRecord(aggregate.body.data)) {
      failures.push('/api/aggregate 缺少 data');
    } else {
      const data = aggregate.body.data;
      if (!isRecord(data.overall) || typeof data.overall.repos !== 'number') {
        failures.push('/api/aggregate 缺少 data.overall.repos');
      }
      if (!Array.isArray(data.trend)) failures.push('/api/aggregate 缺少 data.trend');
      if (!Array.isArray(data.perRepo)) failures.push('/api/aggregate 缺少 data.perRepo');
      if (isRecord(data.overall)) details.push(`aggregate.repos=${String(data.overall.repos)}`);
    }

    if (failures.length > 0) {
      return { status: 'FAIL', detail: failures.join('; ') };
    }
    return { status: 'PASS', detail: `三个端点均 200（${details.join(', ')}）` };
  });

  console.log('');
  console.log(`smoke: ${tally.passed} passed, ${tally.failed} failed, ${tally.skipped} skipped`);

  try {
    db.resetDbForTests();
  } catch {
    // 关闭失败不影响结论
  }
  return tally.failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.log(`FAIL smoke 运行中止: ${messageOf(error)}`);
    process.exit(1);
  });
