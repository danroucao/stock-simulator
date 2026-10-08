import { isTradingDate, hasTradingCalendar } from './trading-calendar';
describe('official 2026 calendar snapshot', () => {
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
