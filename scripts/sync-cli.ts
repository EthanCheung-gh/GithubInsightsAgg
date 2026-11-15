/**
 * `pnpm sync` —— 供 cron / CI 调用的采集入口（WP7）。
 *
 * 用法：
 *   pnpm sync                          # 同步所有 enabled 仓库（默认）
 *   pnpm sync --all --days 30          # 显式指定全部 + 区间
 *   pnpm sync --repo owner/name        # 只同步单个仓库（不存在则先建占位行）
 *   pnpm sync --repo owner/name --json # 机器可消费的 JSON 输出
 *
 * 退出码：0 = 全部成功或部分成功；1 = 至少一个仓库 error；2 = 参数非法。
 *
 * 说明：`SyncRepoResult` 不含耗时字段，这里用 `getSyncRunById(runId).durationMs`
 * 回读本次 run 的落库耗时，避免在 CLI 里另算一份口径。
 */

import { ensureBootstrapped } from '../src/lib/bootstrap';
import { dbPath, resetDbForTests } from '../src/lib/db';
import { getRepoByFullName, insertRepo, normalizeFullName } from '../src/lib/repo-store';
import { getSyncRunById } from '../src/lib/sync-store';
import { effectiveMode, syncAll, syncRepo, type SyncRepoResult } from '../src/lib/sync';
import type { DataMode } from '../src/lib/types';

const DAYS_DEFAULT = 30;
const DAYS_MIN = 7;
const DAYS_MAX = 90;

interface CliOptions {
  repo: string | null;
  days: number;
  all: boolean;
  json: boolean;
}

type ParseResult =
  | { kind: 'help' }
  | { kind: 'error'; message: string; warnings: string[] }
  | { kind: 'ok'; options: CliOptions; warnings: string[] };

interface ResultRow {
  fullName: string;
  status: 'success' | 'partial' | 'error';
  recordsWritten: number;
  durationMs: number | null;
  error: string | null;
  runId: number;
}

interface Summary {
  success: number;
  partial: number;
  error: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/* 参数解析（手写，不引第三方库）                                      */
/* ------------------------------------------------------------------ */

function usage(): string {
  return [
    '用法: pnpm sync [选项]',
    '',
    '选项:',
    '  --repo <owner/name>  只同步指定仓库；库中不存在时先创建占位行再同步',
    '  --days <n>           采集区间天数，7~90，默认 30',
    '  --all                同步所有 enabled 仓库（默认行为）',
    '  --json               以 JSON 输出结果（便于机器消费）',
    '  -h, --help           显示本帮助',
    '',
    '示例:',
    '  pnpm sync --all --days 30',
    '  pnpm sync --repo demo/aurora-ui',
    '  pnpm sync --repo demo/aurora-ui --json',
    '',
    '退出码: 0 = 全部成功或部分成功；1 = 存在失败；2 = 参数非法',
  ].join('\n');
}

function parseDays(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < DAYS_MIN || parsed > DAYS_MAX) return null;
  return Math.trunc(parsed);
}

function parseArgs(argv: string[]): ParseResult {
  const warnings: string[] = [];
  let repo: string | null = null;
  let days = DAYS_DEFAULT;
  let all = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const equalsAt = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const flag = equalsAt >= 0 ? raw.slice(0, equalsAt) : raw;
    const inlineValue = equalsAt >= 0 ? raw.slice(equalsAt + 1) : null;

    if (flag === '--help' || flag === '-h') return { kind: 'help' };

    if (flag === '--json') {
      if (inlineValue !== null) {
        return { kind: 'error', message: '--json 不接受取值', warnings };
      }
      json = true;
      continue;
    }

    if (flag === '--all') {
      if (inlineValue !== null) {
        return { kind: 'error', message: '--all 不接受取值', warnings };
      }
      all = true;
      continue;
    }

    if (flag === '--repo') {
      const value = inlineValue ?? argv[index + 1] ?? '';
      if (inlineValue === null) index += 1;
      const normalized = normalizeFullName(value);
      if (!normalized) {
        return {
          kind: 'error',
          message: `--repo 需要 owner/name 形式（只允许 [A-Za-z0-9_.-]），收到 "${value}"`,
          warnings,
        };
      }
      repo = normalized;
      continue;
    }

    if (flag === '--days') {
      const value = inlineValue ?? argv[index + 1] ?? '';
      if (inlineValue === null) index += 1;
      const parsed = parseDays(value);
      if (parsed === null) {
        return {
          kind: 'error',
          message: `--days 需要 ${DAYS_MIN}~${DAYS_MAX} 之间的整数，收到 "${value}"`,
          warnings,
        };
      }
      days = parsed;
      continue;
    }

    if (flag.startsWith('-')) {
      return { kind: 'error', message: `未知参数: ${flag}`, warnings };
    }
    return { kind: 'error', message: `未知参数: ${raw}`, warnings };
  }

  if (repo !== null && all) {
    warnings.push('warn: 同时指定了 --repo 与 --all，--repo 优先，--all 已忽略');
  }

  return { kind: 'ok', options: { repo, days, all, json }, warnings };
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

/** CJK 字符在终端里占两列，表格对齐需要按显示宽度而不是 UTF-16 长度计算。 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

function padCell(text: string, width: number): string {
  const gap = width - displayWidth(text);
  return gap > 0 ? `${text}${' '.repeat(gap)}` : text;
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, column) =>
    rows.reduce((max, row) => Math.max(max, displayWidth(row[column] ?? '')), displayWidth(header)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, column) => padCell(cell, widths[column])).join('  ').trimEnd();
  console.log(line(headers));
  console.log(line(widths.map((width) => '-'.repeat(width))));
  for (const row of rows) console.log(line(headers.map((_, column) => row[column] ?? '')));
}

function toRow(result: SyncRepoResult): ResultRow {
  let durationMs: number | null = null;
  if (result.runId > 0) {
    try {
      durationMs = getSyncRunById(result.runId)?.durationMs ?? null;
    } catch {
      durationMs = null;
    }
  }
  return {
    fullName: result.fullName,
    status: result.status,
    recordsWritten: result.recordsWritten,
    durationMs,
    error: result.error,
    runId: result.runId,
  };
}

function summarize(rows: ResultRow[]): Summary {
  return {
    success: rows.filter((row) => row.status === 'success').length,
    partial: rows.filter((row) => row.status === 'partial').length,
    error: rows.filter((row) => row.status === 'error').length,
    total: rows.length,
  };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function run(options: CliOptions): Promise<{ rows: ResultRow[]; scope: 'repo' | 'all'; mode: DataMode; seeded: boolean }> {
  const boot = ensureBootstrapped();
  let results: SyncRepoResult[];
  let scope: 'repo' | 'all';

  if (options.repo !== null) {
    scope = 'repo';
    let target = getRepoByFullName(options.repo);
    if (target === null) {
      const [owner, name] = options.repo.split('/');
      target = insertRepo({ owner, name });
      if (!options.json) {
        console.log(`note: 仓库不在库中，已创建占位行 ${target.fullName}（id=${target.id}）`);
      }
    } else if (!target.enabled && !options.json) {
      console.log(`note: ${target.fullName} 处于停用状态，--repo 仍会强制同步。`);
    }
    results = [await syncRepo(target, { days: options.days, trigger: 'cli' })];
  } else {
    scope = 'all';
    results = await syncAll({ days: options.days, trigger: 'cli' });
  }

  return { rows: results.map(toRow), scope, mode: boot.mode, seeded: boot.seeded };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.kind === 'help') {
    console.log(usage());
    return 0;
  }

  if (parsed.kind === 'error') {
    for (const warning of parsed.warnings) console.log(warning);
    console.log(`错误: ${parsed.message}`);
    console.log('');
    console.log(usage());
    return 2;
  }

  const { options, warnings } = parsed;
  // --json 模式下不往 stdout 混入人类文本，warning 一并放进 JSON 的 warnings 字段。
  if (!options.json) {
    for (const warning of warnings) console.log(warning);
  }

  const { rows, scope, mode, seeded } = await run(options);
  const summary = summarize(rows);

  if (options.json) {
    const payload = {
      scope,
      days: options.days,
      mode,
      dbPath: dbPath(),
      warnings,
      results: rows,
      summary,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`scope: ${scope}   days: ${options.days}   trigger: cli`);
    if (mode === 'demo') {
      console.log('note: 未检测到 GitHub Token，本次写入的是确定性演示数据（mode = demo）');
    }
    if (seeded) {
      console.log('note: 首次运行，已自举演示仓库');
    }
    console.log('');

    if (rows.length === 0) {
      console.log('没有需要同步的仓库（repos 表为空或全部停用）。');
    } else {
      printTable(
        ['仓库', '状态', '写入行数', '耗时', '错误'],
        rows.map((row) => [
          row.fullName,
          row.status,
          String(row.recordsWritten),
          row.durationMs === null ? '-' : `${row.durationMs}ms`,
          row.error ?? '-',
        ]),
      );
    }

    console.log('');
    console.log(`成功 ${summary.success} / 部分成功 ${summary.partial} / 失败 ${summary.error}`);
    console.log(`mode: ${mode}`);
    console.log(`db: ${dbPath()}`);
  }

  return summary.error > 0 ? 1 : 0;
}

function finish(code: number): never {
  try {
    // 关闭 SQLite 连接，确保 WAL 内容落盘（脚本进程即将退出）。
    resetDbForTests();
  } catch {
    // 关闭失败不影响退出码
  }
  process.exit(code);
}

main()
  .then((code) => finish(code))
  .catch((error: unknown) => {
    console.log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    finish(1);
  });
