const TONE_COLOR = {
  accent: 'var(--accent)',
  good: 'var(--success)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
} as const;

export function ProgressBar({
  value,
  max = 100,
  tone = 'accent',
  label,
}: {
  value: number;
  max?: number;
  tone?: 'accent' | 'good' | 'warn' | 'danger';
  label?: string;
}) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const ratio = Number.isFinite(value) ? (value / safeMax) * 100 : 0;
  const width = Math.min(100, Math.max(0, ratio));

  return (
    <div className="w-full">
      {label !== undefined ? (
        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="truncate">{label}</span>
          <span className="tabular shrink-0">{Math.round(width)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${width}%`, background: TONE_COLOR[tone] }}
        />
      </div>
    </div>
  );
}
