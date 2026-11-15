import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ModeBadge } from '@/components/layout/ModeBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { TokenPanel } from '@/components/settings/TokenPanel';
import { Card } from '@/components/ui/Card';
import { SyncButton } from '@/components/ui/SyncButton';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { SyncRunTable } from '@/components/dashboard/SyncRunTable';
import { dbPath } from '@/lib/db';
import { num, relTime } from '@/lib/format';
import { deviceFlowAvailable } from '@/lib/github';
import { getRateLimitInfo, resolveToken } from '@/lib/github/client';
import type { TokenSource } from '@/lib/github/types';
import { countRepos, lastSyncedAt } from '@/lib/repo-store';
import { maskToken } from '@/lib/settings-store';
import { listSyncRuns } from '@/lib/sync-store';
import { effectiveMode } from '@/lib/sync';

export const dynamic = 'force-dynamic';

/** Token 来源的中文标签（与 `/api/auth/token` 的 `sourceLabel` 保持一致）。 */
const TOKEN_SOURCE_LABEL: Record<TokenSource, string> = {
  env: '环境变量',
  stored: '应用内保存',
  'gh-cli': 'gh CLI',
  none: '未配置',
};

/**
 * Token 相关外链。
 * 与 `src/app/api/auth/token/route.ts` 中的常量保持一致（该文件不导出常量，避免 route 模块被页面 import）。
 */
const TOKEN_SETTING_URL = 'https://github.com/settings/tokens';
const TOKEN_CREATE_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:org&description=GithubInsightsAgg';

export const metadata: Metadata = {
  title: '设置 · GithubInsightsAgg',
};

function StatusItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-medium tracking-[0.04em] text-muted">{label}</dt>
      <dd className="text-[13px] leading-relaxed text-text">{children}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  const mode = effectiveMode();
  const token = resolveToken();
  const counts = countRepos();
  const syncedAt = lastSyncedAt();
  const rateLimit = getRateLimitInfo();
  const runs = listSyncRuns(20);

  const tokenLabel =
    token.source === 'env'
      ? '已配置（环境变量）'
      : token.source === 'stored'
        ? '已配置（应用内保存）'
        : token.source === 'gh-cli'
          ? '已配置（gh CLI）'
          : '未配置';

  const tokenInitial = {
    configured: token.token !== null,
    source: token.source,
    sourceLabel: TOKEN_SOURCE_LABEL[token.source],
    maskedToken: token.token ? maskToken(token.token) : null,
    canClear: token.source === 'stored',
    deviceFlowAvailable: deviceFlowAvailable(),
    createTokenUrl: TOKEN_CREATE_URL,
    settingUrl: TOKEN_SETTING_URL,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="设置"
        subtitle="运行状态与同步诊断"
        actions={<ThemeToggle />}
      />

      <Card title="GitHub Token" subtitle="用于采集 Traffic 等需要权限的数据">
        <TokenPanel initial={tokenInitial} />
      </Card>

      <Card title="运行状态" subtitle="服务端实时读取，不写入任何数据">
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatusItem label="数据模式">
            <ModeBadge mode={mode} />
          </StatusItem>

          <StatusItem label="Token 来源">
            <span className={token.token ? 'text-success' : 'text-warn'}>{tokenLabel}</span>
          </StatusItem>

          <StatusItem label="数据库路径">
            <code className="tabular block break-all text-[12px] text-muted">{dbPath()}</code>
          </StatusItem>

          <StatusItem label="仓库数">
            <span className="tabular">{num(counts.total)}</span>
            <span className="text-muted"> / 已启用 </span>
            <span className="tabular">{num(counts.enabled)}</span>
          </StatusItem>

          <StatusItem label="最近同步">
            {syncedAt ? (
              <span title={syncedAt}>{relTime(syncedAt)}</span>
            ) : (
              <span className="text-subtle">尚未同步</span>
            )}
          </StatusItem>

          <StatusItem label="API 限额">
            {rateLimit ? (
              <span>
                <span className="tabular">
                  {num(rateLimit.remaining)} / {num(rateLimit.limit)}
                </span>
                <span className="text-muted"> · 重置 {relTime(rateLimit.resetAt)}</span>
              </span>
            ) : (
              <span className="text-subtle">尚未调用 GitHub API</span>
            )}
          </StatusItem>
        </dl>
      </Card>

      <Card title="同步记录" subtitle="最近 20 次采集记录">
        <SyncRunTable runs={runs} />
      </Card>

      <Card title="采集范围说明">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-muted">
          <li className="flex gap-2">
            <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>
              Traffic（访问量 / 克隆量 / 来源 / 热门页面）只能采集当前 Token 具有{' '}
              <span className="text-text">push 权限</span> 的仓库，这是 GitHub 平台的限制；无权限时其余指标照常采集。
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>
              GitHub 只提供最近 <span className="text-text">14 天</span> 的 Traffic 明细，
              本项目每日同步会把窗口持续累积到本地库，因此运行越久历史越完整。
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>
              <code className="tabular text-text">/stats/*</code> 系列接口在 GitHub 未命中缓存时会返回「计算中」（202），
              同步流程会自动退避重试；仍失败时本次同步标记为「部分成功」，不影响其他指标。
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>
              建议用 cron 定时执行 <code className="tabular text-text">pnpm sync</code>，
              保持 Traffic 窗口与快照连续。
            </span>
          </li>
        </ul>
      </Card>

      <Card title="危险操作" subtitle="重新采集所有已启用仓库">
        <div className="flex flex-col gap-2">
          <p className="text-[12px] leading-relaxed text-muted">
            会依次同步全部已启用仓库，消耗 GitHub API 配额；不会清除本地历史数据。
          </p>
          <div>
            <SyncButton label="重新同步全部" variant="primary" />
          </div>
        </div>
      </Card>
    </div>
  );
}
