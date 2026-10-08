import { StockHistoryPoint } from '../stock-price.service';

export function planningReference(history: StockHistoryPoint[]) {
  const latest = history.at(-1);
  const previous = history.at(-2);
  const prior20 = history.slice(-21, -1);
  let atr: number | null = null;
  const ranges = history.map((point, index) => index === 0 ? point.high - point.low :
    Math.max(point.high - point.low, Math.abs(point.high - history[index - 1].close), Math.abs(point.low - history[index - 1].close)));
  if (ranges.length >= 14) {
    atr = ranges.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14;
    for (const range of ranges.slice(14)) atr = (atr * 13 + range) / 14;
  }
  const meanVolume = prior20.length === 20 ? prior20.reduce((sum, point) => sum + point.volume, 0) / 20 : null;
  return {
    date: latest?.date ?? '', previousDate: previous?.date ?? '',
    previousHigh: previous?.high ?? null, previousLow: previous?.low ?? null,
    high20: prior20.length === 20 ? Math.max(...prior20.map(point => point.high)) : null,
    low20: prior20.length === 20 ? Math.min(...prior20.map(point => point.low)) : null,
    atr, relativeVolume: latest && meanVolume !== null && meanVolume > 0 ? latest.volume / meanVolume : null,
  };
}
