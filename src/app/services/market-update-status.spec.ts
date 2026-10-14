import { describe, expect, it } from 'vitest';
import { marketUpdateStatus } from './market-update-status';

const calendar = { calendarYears: [2026], closedDates: [] as string[] };
describe('market update status', () => {
  it('shows the completed close date independently from scan time', () => {
    const result = marketUpdateStatus({ ...calendar, date: '2026-10-14', scannedAt: '2026-10-14T09:00:00Z', status: 'ready' }, new Date('2026-10-14T13:18:00Z'));
    expect(result.kind).toBe('current');
    expect(result.headline).toBe('10／14 收盤行情');
  });
  it('describes the expected close and retained result after close', () => {
    const result = marketUpdateStatus({ ...calendar, date: '2026-10-13', scannedAt: '2026-10-13T10:00:00Z', status: 'ready' }, new Date('2026-10-14T08:00:00Z'));
    expect(result.kind).toBe('updating');
    expect(result.headline).toBe('10／14 收盤資料更新中，目前暫顯示 10／13');
  });
  it('keeps the failure reason and retained market date', () => {
    const result = marketUpdateStatus({ ...calendar, date: '2026-10-13', scannedAt: '2026-10-13T10:00:00Z', attemptedAt: '2026-10-14T08:00:00Z', status: 'error', message: '上櫃行情尚未齊全', expectedDate: '2026-10-14' }, new Date('2026-10-14T08:10:00Z'));
    expect(result.kind).toBe('failed');
    expect(result.detail).toContain('上櫃行情尚未齊全');
    expect(result.detail).toContain('10／13');
  });
});
