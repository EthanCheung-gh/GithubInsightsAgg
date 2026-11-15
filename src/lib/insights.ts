import { addDaysKey } from './date';
import { getCommitTotalForRange } from './metrics-store';
import type {
  AggregateMetrics,
  Insight,
  InsightLevel,
  RepoMetrics,
  RepoSummary,
  TrafficReferrerRow,
} from './types';

/**
 * 规则化洞察引擎（契约 §10）。
 *
 * - 中文输出，`title` ≤ 18 字、`detail` ≤ 60 字（按 Unicode 码点计数）。
 * - 最多 6 条；排序 critical > warn > info > good，同级按「影响面」降序。
 * - 影响面（impact）只用于同级排序，取各规则能代表影响范围的量纲：
 *   变化率取百分点、集中度取占比百分点、积压取 Issue 数、健康度取失分、Stars 取增量。
 */

const MAX_INSIGHTS = 6;
const TITLE_MAX = 18;
const DETAIL_MAX = 60;

const LEVEL_ORDER: Record<InsightLevel, number> = {
  critical: 0,
  warn: 1,
  info: 2,
  good: 3,
};

interface RuleHit {
  level: InsightLevel;
  title: string;
  detail: string;
  metric?: string;
  impact: number;
}

interface RuleContext {
  days: number;
  views: number;
  previousViews: number;
  clones: number;
  cloneRate: number;
  totalCommits: number;
  previousCommits: number;
  openIssues: number;
  /** 聚合层没有 issuesOpened，无法计算关闭率时传 null 跳过该规则 */
  closeRate: number | null;
  starDelta: number;
  stars: number;
  communityHealthPercentage: number | null;
  missingChecklist: string[];
  referrers: TrafficReferrerRow[];
  includeZeroTraffic: boolean;
}

function normalizeDays(days: number, fallback: number): number {
  if (Number.isFinite(days) && days > 0) return Math.trunc(days);
  return Number.isFinite(fallback) && fallback > 0 ? Math.trunc(fallback) : 30;
}

/** 按 Unicode 码点截断，避免把 emoji / 代理对切成半个字符。 */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

function fmtNum(value: number): string {
  const rounded = Math.round(value);
  return Math.abs(rounded) >= 1000 ? rounded.toLocaleString('en-US') : String(rounded);
}

function pct(value: number, opts?: { signed?: boolean }): string {
  const rounded = Math.round(value * 1000) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  const sign = opts?.signed && rounded > 0 ? '+' : '';
  return `${sign}${text}%`;
}

/** 环比变化率；上期为 0 或数据非法时返回 null（无法计算，不产出洞察）。 */
function changeRate(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

function buildSharedRules(ctx: RuleContext): RuleHit[] {
  const hits: RuleHit[] = [];

  // 规则 1：流量环比变化（|Δ| ≥ 30%，上升 good / 下滑 critical）
  const viewChange = changeRate(ctx.views, ctx.previousViews);
  if (viewChange !== null && Math.abs(viewChange) >= 0.3) {
    const rising = viewChange > 0;
    hits.push({
      level: rising ? 'good' : 'critical',
      title: rising ? '访问量环比上升' : '访问量环比下滑',
      detail: `近 ${ctx.days} 天访问 ${fmtNum(ctx.views)}，较上一周期 ${pct(viewChange, { signed: true })}`,
      metric: 'traffic.views',
      impact: Math.abs(viewChange) * 100,
    });
  }

  // 规则 2：克隆异常（cloneRate > 25%）
  if (ctx.cloneRate > 0.25) {
    hits.push({
      level: 'warn',
      title: '克隆比例偏高',
      detail: `克隆/访问 ${pct(ctx.cloneRate)}（${fmtNum(ctx.clones)} 次），可能存在自动化同步或镜像`,
      metric: 'traffic.cloneRate',
      impact: ctx.cloneRate * 100,
    });
  }

  // 规则 3：来源集中（top referrer 占比 > 60%）
  const referrerTotal = ctx.referrers.reduce((acc, row) => acc + row.count, 0);
  const topReferrer = ctx.referrers[0];
  if (topReferrer && referrerTotal > 0) {
    const share = topReferrer.count / referrerTotal;
    if (share > 0.6) {
      hits.push({
        level: 'info',
        title: '来源高度集中',
        detail: `「${topReferrer.referrer}」占来源访问 ${pct(share)}（${fmtNum(topReferrer.count)}/${fmtNum(referrerTotal)}）`,
        metric: 'traffic.referrers',
        impact: share * 100,
      });
    }
  }

  // 规则 4：提交活跃度下滑（≤ -40%）
  const commitChange = changeRate(ctx.totalCommits, ctx.previousCommits);
  if (commitChange !== null && commitChange <= -0.4) {
    hits.push({
      level: 'warn',
      title: '提交活跃度下滑',
      detail: `近 ${ctx.days} 天提交 ${fmtNum(ctx.totalCommits)}，较上一周期 ${pct(commitChange, { signed: true })}`,
      metric: 'activity.totalCommits',
      impact: Math.abs(commitChange) * 100,
    });
  }

  // 规则 5：Issues 积压（关闭率 < 50% 且未关闭 > 5）
  if (ctx.closeRate !== null && ctx.closeRate < 0.5 && ctx.openIssues > 5) {
    hits.push({
      level: 'warn',
      title: 'Issue 积压风险',
      detail: `关闭率 ${pct(ctx.closeRate)}，仍有 ${fmtNum(ctx.openIssues)} 个 Issue 未关闭`,
      metric: 'issues.closeRate',
      impact: ctx.openIssues,
    });
  }

  // 规则 6：社区健康（healthPercentage < 100，列出缺失项）
  if (ctx.communityHealthPercentage !== null && ctx.communityHealthPercentage < 100) {
    const missing = ctx.missingChecklist;
    hits.push({
      level: 'info',
      title: '社区健康度待完善',
      detail:
        missing.length > 0
          ? `健康度 ${ctx.communityHealthPercentage}%，缺少：${missing.join('、')}`
          : `健康度 ${ctx.communityHealthPercentage}%，尚未达到满分`,
      metric: 'community.healthPercentage',
      impact: 100 - ctx.communityHealthPercentage,
    });
  }

  // 规则 7：Stars 增长
  if (ctx.starDelta > 0) {
    hits.push({
      level: 'good',
      title: 'Stars 持续增长',
      detail: `近 ${ctx.days} 天新增 ${fmtNum(ctx.starDelta)} stars（当前 ${fmtNum(ctx.stars)}）`,
      metric: 'overview.starDelta',
      impact: ctx.starDelta,
    });
  }

  // 规则 8：区间内零流量
  if (ctx.includeZeroTraffic && ctx.views === 0) {
    hits.push({
      level: 'warn',
      title: `近 ${ctx.days} 天无访问记录`,
      detail: '可能仓库未公开，或 Traffic 数据尚未采集到',
      metric: 'traffic.views',
      impact: 100,
    });
  }

  return hits;
}

/** 代码量相关规则（估算口径，见 analytics.ts 的 computeCodeMetrics）。 */
function buildCodeRules(m: Omit<RepoMetrics, 'insights'>, days: number): RuleHit[] {
  const hits: RuleHit[] = [];
  const code = m.code;

  // 规则 9：代码规模收缩（近窗口净删占估算总量 ≥ 2%）
  const net = code.last30d.net;
  if (net < 0) {
    const shrinkRate = Math.abs(net) / Math.max(1, code.estimatedLines);
    if (shrinkRate >= 0.02) {
      hits.push({
        level: 'warn',
        title: '代码规模收缩',
        detail: `近 ${days} 天净删 ${fmtNum(Math.abs(net))} 行（估算总量的 ${pct(shrinkRate)}）`,
        metric: 'code.last30d.net',
        impact: shrinkRate * 100,
      });
    }
  }

  // 规则 10：技术栈单一（语言数 ≥ 3 但首位占估算行数 ≥ 85%）
  const topLanguage = code.byLanguage[0];
  if (code.byLanguage.length >= 3 && topLanguage && topLanguage.percent >= 0.85) {
    hits.push({
      level: 'info',
      title: '技术栈单一',
      detail: `${topLanguage.language} 占估算行数 ${pct(topLanguage.percent)}`,
      metric: 'code.byLanguage',
      impact: topLanguage.percent * 100,
    });
  }

  return hits;
}

function finalize(hits: RuleHit[]): Insight[] {
  return [...hits]
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.impact - a.impact)
    .slice(0, MAX_INSIGHTS)
    .map((hit) => ({
      level: hit.level,
      title: clip(hit.title, TITLE_MAX),
      detail: clip(hit.detail, DETAIL_MAX),
      ...(hit.metric === undefined ? {} : { metric: hit.metric }),
    }));
}

/** 上一等长区间的提交总数（与 analytics.ts 的 previousTotals 区间口径一致）。 */
function previousCommitTotal(repoId: number, fromKey: string, days: number): number {
  const prevTo = addDaysKey(fromKey, -1);
  const prevFrom = addDaysKey(prevTo, -(days - 1));
  return getCommitTotalForRange(repoId, prevFrom, prevTo);
}

export function buildRepoInsights(m: Omit<RepoMetrics, 'insights'>, days: number): Insight[] {
  const windowDays = normalizeDays(days, m.range.days);
  const hits = buildSharedRules({
    days: windowDays,
    views: m.traffic.totals.views,
    previousViews: m.traffic.previousTotals.views,
    clones: m.traffic.totals.clones,
    cloneRate: m.traffic.cloneRate,
    totalCommits: m.activity.totalCommits,
    previousCommits: previousCommitTotal(m.repo.id, m.range.from, m.range.days),
    openIssues: m.issues.openIssues,
    closeRate: m.issues.closeRate,
    starDelta: m.overview.starDelta,
    stars: m.overview.stars,
    communityHealthPercentage: m.overview.community?.healthPercentage ?? null,
    missingChecklist: (m.overview.community?.checklist ?? [])
      .filter((item) => !item.ok)
      .map((item) => item.label),
    referrers: m.traffic.referrers,
    includeZeroTraffic: true,
  });
  hits.push(...buildCodeRules(m, windowDays));
  return finalize(hits);
}

export function buildAggregateInsights(
  a: Omit<AggregateMetrics, 'insights'>,
  repos: RepoSummary[],
  days: number,
): Insight[] {
  const windowDays = normalizeDays(days, a.range.days);
  const repoCount = Math.max(a.overall.repos, repos.length);
  if (repoCount === 0) return [];

  const hits = buildSharedRules({
    days: windowDays,
    views: a.overall.views,
    previousViews: a.previous.views,
    clones: a.overall.clones,
    cloneRate: a.overall.cloneRate,
    totalCommits: a.overall.commits,
    previousCommits: a.previous.commits,
    openIssues: a.overall.openIssues,
    // 聚合层没有 issuesOpened / 社区档案 / 来源明细，规则 3/5/6 只在单仓层产出
    closeRate: null,
    starDelta: a.overall.starDelta,
    stars: a.overall.stars,
    communityHealthPercentage: null,
    missingChecklist: [],
    referrers: [],
    includeZeroTraffic: true,
  });

  // 聚合补充 1：流量集中度（单仓占全部 > 70%）
  const totalViews = a.overall.views;
  if (totalViews > 0 && a.perRepo.length > 0) {
    const top = [...a.perRepo].sort((x, y) => y.views - x.views)[0];
    const share = top.views / totalViews;
    if (share > 0.7) {
      hits.push({
        level: 'info',
        title: `流量高度集中于 ${top.fullName}`,
        detail: `${top.fullName} 占全部访问 ${pct(share)}（${fmtNum(top.views)}/${fmtNum(totalViews)}）`,
        metric: 'overall.views',
        impact: share * 100,
      });
    }
  }

  // 聚合补充 2：仓库间健康度差异（头尾差 > 40 分）
  if (a.perRepo.length >= 2) {
    const sorted = [...a.perRepo].sort((x, y) => y.healthScore - x.healthScore);
    const head = sorted[0];
    const tail = sorted[sorted.length - 1];
    const gap = head.healthScore - tail.healthScore;
    if (gap > 40) {
      hits.push({
        level: 'info',
        title: '仓库健康度差异明显',
        detail: `${head.fullName} ${head.healthScore} 分，${tail.fullName} 仅 ${tail.healthScore} 分`,
        metric: 'overall.healthScore',
        impact: gap,
      });
    }
  }

  // 聚合补充 3：语言集中度（首位语言占估算行数 ≥ 60%）
  const topCodeLanguage = a.code.byLanguage[0];
  if (topCodeLanguage && topCodeLanguage.percent >= 0.6) {
    hits.push({
      level: 'info',
      title: '语言集中度高',
      detail: `全部仓库中 ${topCodeLanguage.language} 占估算行数 ${pct(topCodeLanguage.percent)}`,
      metric: 'code.byLanguage',
      impact: topCodeLanguage.percent * 100,
    });
  }

  return finalize(hits);
}
