import { isTradingDate, hasTradingCalendar, latestTradingDate } from './trading-calendar';
describe('official 2026 calendar snapshot', () => {
  it('resolves holidays and weekends to the last trading day', () => {
    expect(latestTradingDate('2026-10-09')).toBe('2026-10-08');
    expect(latestTradingDate('2026-10-11')).toBe('2026-10-08');
    expect(latestTradingDate('2026-10-12')).toBe('2026-10-12');
    expect(latestTradingDate('2026-02-20')).toBe('2026-02-11');
  });
  it('excludes settlement-only days and substitute holidays', () => {
    expect(isTradingDate('2026-02-12')).toBe(false);
    expect(isTradingDate('2026-02-13')).toBe(false);
    expect(isTradingDate('2026-10-09')).toBe(false);
    expect(isTradingDate('2026-10-26')).toBe(false);
    expect(isTradingDate('2026-02-23')).toBe(true);
    expect(isTradingDate('2026-10-12')).toBe(true);
  });
  it('reports coverage and rejects malformed dates', () => {
    expect(hasTradingCalendar('2027-01-01')).toBe(false);
    expect(isTradingDate('2026-02-30')).toBe(false);
  });
});
