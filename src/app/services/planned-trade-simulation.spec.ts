import { simulatePlannedTrade, PlannedTradeConfig } from './planned-trade-simulation';
import { StockHistoryPoint } from '../stock-price.service';
const plan: PlannedTradeConfig = { entry: 100, stop: 95, target: 110, shares: 100, type: '現股多單', capital: 100000, feeDiscount: .6, financingRate: 4.5, borrowRate: 3.2 };
const bar = (date: string, open: number, high: number, low: number, close: number): StockHistoryPoint => ({ date, open, high, low, close, name: '', change: 0, volume: 1000, turnover: 0 });
describe('single planned trade simulation', () => {
  it('cancels entry instead of creating a profitable stop after an opening gap', () => {
    const long = simulatePlannedTrade([bar('115/10/01', 90, 96, 88, 94)], plan);
    expect(long.entryDate).toBe('');
    expect(long.profit).toBe(0);
    expect(long.status).toContain('開盤越過停損');
    const short = simulatePlannedTrade([bar('115/10/01', 110, 112, 103, 104)], { ...plan, type: '空單', stop: 105, target: 90 });
    expect(short.entryDate).toBe('');
    expect(short.profit).toBe(0);
  });
  it('uses stop first when the same daily bar touches both exits', () => {
    const result = simulatePlannedTrade([bar('115/10/01', 100, 112, 94, 105)], plan);
    expect(result.exitPrice).toBe(95); expect(result.ambiguousDays).toBe(1); expect(result.profit).toBeLessThan(-500);
  });
  it('uses next-day opening price when price gaps through a stop', () => {
    const result = simulatePlannedTrade([bar('115/10/01', 100, 104, 99, 101), bar('115/10/02', 90, 92, 88, 91)], plan);
    expect(result.exitPrice).toBe(90); expect(result.reason).toContain('跳空');
  });
  it('does not enter when limit is untouched and enforces capital limits', () => {
    expect(simulatePlannedTrade([bar('115/10/01', 105, 110, 103, 108)], plan).status).toBe('未進場');
    expect(simulatePlannedTrade([], { ...plan, capital: 100 }).error).toContain('資金不足');
  });
  it('supports short direction with a lower profit target', () => {
    const result = simulatePlannedTrade([bar('115/10/01', 100, 102, 89, 90)], { ...plan, type: '空單', stop: 105, target: 90 });
    expect(result.status).toBe('已出場'); expect(result.exitPrice).toBe(90); expect(result.profit).toBeGreaterThan(0);
  });
});
