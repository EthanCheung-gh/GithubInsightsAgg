import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AppShell } from '@/components/layout/AppShell';

/**
 * 主题初始化：在样式与首屏渲染前把 localStorage 的主题写回 <html data-theme>，
 * 避免刷新时的暗色 → 亮色闪烁。脚本必须极小且不能抛错。
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=window.localStorage.getItem('gia-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'GithubInsightsAgg · GitHub 洞察聚合分析',
  description:
    '聚合 GitHub 仓库的 Traffic、Commits、Issues 与 Community 指标，支持跨仓库对比、健康度评分与规则化洞察。',
  applicationName: 'GithubInsightsAgg',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-bg text-text antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
