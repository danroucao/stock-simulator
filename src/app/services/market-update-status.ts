import { hasTradingCalendar, latestTradingDate } from './trading-calendar';

export interface MarketUpdateSource {
  date: string | null;
  scannedAt: string | null;
  status: 'ready' | 'error' | 'unconfigured';
  attemptedAt?: string;
  expectedDate?: string;
  message?: string;
  calendarYears?: number[];
  closedDates?: string[];
}

export interface MarketUpdateStatus {
  kind: 'current' | 'updating' | 'waiting' | 'failed' | 'unavailable';
  headline: string;
  detail: string;
  expectedDate: string | null;
}

const taipeiDate = (now: Date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(now);
const taipeiMinutes = (now: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === 'hour')?.value) * 60 +
    Number(parts.find((part) => part.type === 'minute')?.value);
};
const taipeiTime = (value: string | null | undefined) => {
  if (!value || !Number.isFinite(Date.parse(value))) return '尚無紀錄';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value));
};
export const shortMarketDate = (value: string | null | undefined) =>
  value ? `${Number(value.slice(5, 7))}／${Number(value.slice(8, 10))}` : '尚未取得';

export function expectedMarketDate(
  source: Pick<MarketUpdateSource, 'calendarYears' | 'closedDates'>,
  now = new Date(),
): string | null {
  const today = taipeiDate(now);
  const afterClose = taipeiMinutes(now) >= 15 * 60 + 30;
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!afterClose) cursor.setUTCDate(cursor.getUTCDate() - 1);
  const candidate = cursor.toISOString().slice(0, 10);
  const currentCalendar =
    source.calendarYears?.includes(Number(today.slice(0, 4))) && Array.isArray(source.closedDates);
  if (!currentCalendar) return hasTradingCalendar(today) ? latestTradingDate(candidate) : null;
  const closed = new Set(source.closedDates);
  for (let offset = 0; offset < 366; offset++) {
    const value = cursor.toISOString().slice(0, 10);
    if (![0, 6].includes(cursor.getUTCDay()) && !closed.has(value)) return value;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return null;
}

export function marketUpdateStatus(source: MarketUpdateSource | null, now = new Date()): MarketUpdateStatus {
  if (!source?.date) return { kind: 'unavailable', headline: '收盤行情尚未取得', detail: '', expectedDate: null };
  const calculated = expectedMarketDate(source, now);
  const expected = source.expectedDate && source.expectedDate > source.date
    ? source.expectedDate
    : calculated;
  const shown = shortMarketDate(source.date);
  if (source.status === 'error') {
    return {
      kind: 'failed',
      headline: '最近一次市場掃描失敗',
      detail: `執行狀態：失敗；最後嘗試 ${taipeiTime(source.attemptedAt)}（台北）。${source.message || '未提供失敗原因'}；目前保留 ${shown} 結果。`,
      expectedDate: expected,
    };
  }
  if (expected && source.date < expected) {
    return {
      kind: 'waiting',
      headline: `${shortMarketDate(expected)} 收盤資料尚未完成，目前暫顯示 ${shown}`,
      detail: `執行狀態：尚未取得本交易日完成或失敗紀錄；最後嘗試 ${taipeiTime(source.attemptedAt)}（台北）。等待上市／上櫃官方日線齊全後，才會產生選股與產業統計。`,
      expectedDate: expected,
    };
  }
  return {
    kind: 'current',
    headline: `${shown} 收盤行情`,
    detail: '',
    expectedDate: expected,
  };
}
