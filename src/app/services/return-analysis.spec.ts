import { compareDailyReturns } from './return-analysis';
import { StockHistoryPoint } from '../stock-price.service';

describe('aligned return analysis', () => {
  function rows(multiplier: number): StockHistoryPoint[] {
    let close = 100;
    return Array.from({ length: 41 }, (_, index) => {
      if (index) close *= 1 + (index % 2 ? .01 : -.005) * multiplier;
      return { date: `day-${index}`, close, open: close, high: close, low: close, volume: 100, turnover: 0, change: 0, name: '' };
    });
  }
  it('calculates correlation and beta on matching return intervals', () => {
    const result = compareDailyReturns(rows(2), rows(1));
    expect(result.observations).toBe(40);
    expect(result.correlation).toBeCloseTo(1);
    expect(result.beta).toBeCloseTo(2);
  });
  it('rejects inadequate observations and avoids comparing different date intervals', () => {
    expect(compareDailyReturns(rows(1).slice(0, 20), rows(1)).beta).toBeNull();
    const missingDay = rows(1).filter((_, index) => index !== 10);
    expect(compareDailyReturns(missingDay, rows(1)).observations).toBe(38);
  });
});
