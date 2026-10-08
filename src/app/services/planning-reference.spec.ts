import { planningReference } from './planning-reference';
import { StockHistoryPoint } from '../stock-price.service';

describe('planning reference', () => {
  const history = (): StockHistoryPoint[] => Array.from({length: 21}, (_, i) => ({ date: String(i), name: '', open: 100, high: 102, low: 98, close: 100, volume: i === 20 ? 200 : 100, turnover: 0, change: 0 }));
  it('excludes the current bar from prior price ranges and average volume', () => {
    const points = history();
    points[20].high = 120;
    points[20].low = 90;
    const result = planningReference(points);
    expect(result.high20).toBe(102);
    expect(result.low20).toBe(98);
    expect(result.relativeVolume).toBe(2);
    expect(result.atr).toBeCloseTo((4 * 13 + 30) / 14);
  });
  it('handles gaps in true range and reports missing windows as null', () => {
    expect(planningReference([]).atr).toBeNull();
    const points = history().slice(0, 14);
    points[13].high = 112;
    points[13].low = 110;
    expect(planningReference(points).atr).toBeCloseTo((4 * 13 + 12) / 14);
    expect(planningReference(points).relativeVolume).toBeNull();
  });
});
