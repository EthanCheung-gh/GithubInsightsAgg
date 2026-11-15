# 组件速查（WP5 / WP6 直接照抄）

所有组件都只使用 `globals.css` 里的 CSS 变量与通用类名（`.card` `.badge` `.btn` `.input` `.table` `.skeleton` `.tabular`），
**页面里不要硬编码颜色**，需要颜色时用 `bg-surface-2` / `text-muted` / `border-border` 这类 Tailwind 主题类。

页面默认是 Server Component；下表标「客户端」的组件文件首行已有 `'use client'`，从服务端页面直接 import 即可（无需自己加指令）。

---

## 布局组件 `@/components/layout/*`

### AppShell：侧边栏 + 内容列（`app/layout.tsx` 已全局套用，页面不用再写）
```tsx
// 页面只要返回内容即可，外壳由 app/layout.tsx 提供
return <main className="flex flex-col gap-4">…</main>;
```

### PageHeader：页面标题区（面包屑 + 22px 标题 + 右侧操作）
```tsx
<PageHeader title="仓库总览" subtitle="最近 30 天 · 3 个仓库" breadcrumb={[{ label: '总览', href: '/' }]}
  actions={<SyncButton label="同步全部" />} />
```

### TopBar：56px 顶栏（标题 15px + 右侧 actions），放在内容区顶部
```tsx
<TopBar title="对比" subtitle="选择 2~4 个仓库" actions={<ThemeToggle />} />
```

### ModeBadge：数据模式徽章（live 绿点「实时数据」/ demo 黄点「演示数据」）
```tsx
<ModeBadge mode={data.mode} />
```

### Sidebar：232px 固定侧边栏（AppShell 已渲染；单独使用时）
```tsx
<Sidebar active="/repos" mode="demo" />
```

---

## UI 基础组件 `@/components/ui/*`

### Card：卡片容器（title / subtitle / actions / children）
```tsx
<Card title="流量趋势" subtitle="近 30 天" actions={<Badge tone="info">views</Badge>}>
  <TrendChart data={rows} series={[{ key: 'views', label: '访问量', area: true }]} />
</Card>
```

### KpiCard：KPI 数字卡（delta 传 0~1 的环比，自动显示 ↑/↓ 与百分比）
```tsx
<KpiCard label="访问量" value={compact(overall.views)} delta={deltaPct(overall.views, previous.views)}
  deltaLabel="vs 上期" icon={<Eye size={15} />} tone="good" href="/repos" />
```

### Badge：状态徽章（neutral / good / warn / danger / info）
```tsx
<Badge tone="warn">积压 12</Badge>
<Badge>TypeScript</Badge>
```

### Button：按钮（primary / ghost / danger，sm / md，loading 自动禁用）
```tsx
<Button variant="primary" onClick={save} loading={saving}>保存</Button>
<Button variant="ghost" size="sm">取消</Button>
```

### Tabs：受控页签（客户端）
```tsx
<Tabs tabs={[{ key: '7', label: '7 天' }, { key: '30', label: '30 天', count: 30 }]} value={range} onChange={setRange} />
```

### DataTable：可排序表格（列定义 + rowKey）
```tsx
<DataTable columns={columns} rows={ranks} rowKey={(r) => r.fullName} initialSortKey="views" initialSortDir="desc" />
```
```tsx
const columns: Column<RepoRankRow>[] = [
  { key: 'fullName', header: '仓库', render: (r) => <span className="tabular">{r.fullName}</span> },
  { key: 'views', header: '访问量', align: 'right', sortValue: (r) => r.views, render: (r) => compact(r.views) },
];
```

### EmptyState：空态（可带 action 按钮）
```tsx
<EmptyState title="还没有仓库" description="添加一个 owner/name 开始采集数据" action={<AddRepoForm />} />
```

### Skeleton：骨架屏占位
```tsx
<Skeleton className="h-24 w-full" />
```

### ProgressBar：进度/占比条（value / max）
```tsx
<ProgressBar value={metrics.healthScore} max={100} tone="good" label="健康度" />
```

### ThemeToggle：亮/暗主题切换（客户端）
```tsx
<ThemeToggle />
```

### SyncButton：触发 `POST /api/sync` 后自动 refresh（客户端）
```tsx
<SyncButton fullName="demo/aurora-ui" label="同步" variant="ghost" size="sm" />
```

### AddRepoForm：添加仓库（客户端，成功后 refresh）
```tsx
<AddRepoForm className="w-[360px]" />
```

---

## 图表组件 `@/components/charts/*`（全部客户端，颜色自动跟随主题）

没有 barrel 文件，按需逐文件导入：
```tsx
import { Chart } from '@/components/charts/Chart';
import { TrendChart } from '@/components/charts/TrendChart';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { RankBarChart } from '@/components/charts/RankBarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { WeekdayBarChart } from '@/components/charts/WeekdayBarChart';
```

图表高度默认 280（Sparkline 默认 36，RankBarChart 按行数自适应）；宽度始终撑满父容器（内部 `ResizeObserver`）。
数值单位/千分位统一走 `@/lib/format` 的 `compact`，不要在页面里再写格式化。

### TrendChart：折线/柱状趋势图（`data` 必须有 `date` 字段）
```tsx
<TrendChart data={aggregate.trend} valueSuffix="" height={260}
  series={[{ key: 'views', label: '访问量', area: true }, { key: 'clones', label: '克隆', area: true },
           { key: 'commits', label: '提交', type: 'bar' }]} />
```

### StackedBarChart：堆叠柱状图（issues / PR 构成）
```tsx
<StackedBarChart data={issues.daily} height={240}
  series={[{ key: 'issuesOpened', label: '新开 Issue' }, { key: 'issuesClosed', label: '关闭 Issue' }]} />
```

### RankBarChart：横向排行榜（自动按 value 降序，只显示前 maxRows，默认 8）
```tsx
<RankBarChart rows={perRepo.map((r) => ({ label: r.fullName, value: r.views, hint: `克隆 ${compact(r.clones)}` }))}
  valueSuffix=" 次" />
```

### DonutChart：环形图（语言占比 / 来源构成），中心显示主数值
```tsx
<DonutChart rows={languageMix.map((l) => ({ label: l.language, value: l.bytes }))}
  height={240} centerLabel="总字节" centerValue={compact(totalBytes)} />
```

### Sparkline：迷你折线（KPI 卡内嵌，无轴无 tooltip）
```tsx
<Sparkline values={trend.map((t) => t.views)} height={36} />
```

### WeekdayBarChart：星期分布（7 根柱，柱顶直出数值）
```tsx
<WeekdayBarChart rows={WEEKDAYS.map((label, i) => ({ label, value: byWeekday[i] ?? 0 }))} height={220} />
```

### Chart：需要自定义 option 时直接用底层容器
```tsx
import { Chart } from '@/components/charts/Chart';
import type { EChartsOption } from '@/components/charts/echarts-setup';

const option: EChartsOption = { xAxis: { type: 'category', data: ['a', 'b'] }, yAxis: { type: 'value' },
  series: [{ type: 'line', data: [1, 2] }] };

<Chart option={option} height={280} loading={pending} />
```
自定义 option 时请从 `getChartPalette()` 取色（`palette.series[i]`、`palette.textMuted`、`palette.border`），不要写字面量色值。

---

## 数据与格式化

```tsx
import { compact, num, pct, deltaPct, shortDate, relTime, cn } from '@/lib/format';
import { api } from '@/lib/client-api';           // 客户端组件里调接口：await api.aggregate(30)
import type { AggregateMetrics, RepoMetrics } from '@/lib/types';
```

服务端页面推荐直接调用 `src/lib/analytics.ts` / `metrics-store.ts` 的读取函数（由 WP3 提供），
只有需要交互刷新时才用 `api.*`。
