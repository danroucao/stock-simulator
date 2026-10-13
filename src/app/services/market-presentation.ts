import type { MetricKey } from './market-analysis';
import type { DailyBar } from './market-alerts';
export function chartChange(
  bar: DailyBar,
  basis?: string,
): { change: number; changeKnown: boolean } {
  const known =
    basis !== 'adjusted' && typeof bar.change === 'number' && Number.isFinite(bar.change);
  return { change: known ? bar.change! : 0, changeKnown: known };
}

export function amount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '未知';
  if (Math.abs(value) >= 1e8) return (value / 1e8).toFixed(2) + ' 億元';
  if (Math.abs(value) >= 1e4) return (value / 1e4).toFixed(2) + ' 萬元';
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value) + ' 元';
}

export function boundLabel(
  key: MetricKey,
  label: string,
  bound: { min?: number; max?: number },
): string {
  const value = (n: number) => (key === 'averageTurnover' ? amount(n) : n.toFixed(2) + '%');
  const name = label.replace(/（.*）$/, '');
  return (
    name +
    (bound.min !== undefined && bound.max !== undefined
      ? ` ${value(bound.min)}～${value(bound.max)}`
      : bound.min !== undefined
        ? ` ≥ ${value(bound.min)}`
        : bound.max !== undefined
          ? ` ≤ ${value(bound.max)}`
          : ' 不限')
  );
}
