'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'gia-theme';

type Theme = 'dark' | 'light';

export function ThemeToggle() {
  // 渲染期不读 window / localStorage：默认 dark，挂载后再同步真实值
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 隐私模式下 localStorage 可能不可写，忽略
    }
  }

  const isDark = theme === 'dark';
  const label = isDark ? '切换到亮色主题' : '切换到暗色主题';

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="btn btn--ghost btn--sm"
    >
      {isDark ? <Moon size={13} /> : <Sun size={13} />}
      <span>{isDark ? '暗色' : '亮色'}</span>
    </button>
  );
}
