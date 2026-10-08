import { calculateVolumeIndicators } from './volume-indicators';
import { StockHistoryPoint } from '../stock-price.service';

function point(close: number, volume: number, high = 12, low = 8): StockHistoryPoint {
  return { date: '115/10/08', name: 'test', open: 10, high, low, close, volume, turnover: 0, change: 0 };
}

describe('volume indicators', () => {
  it('adds rising volume, subtracts falling volume and leaves unchanged closes alone', () => {
    const result = calculateVolumeIndicators([point(10, 100), point(12, 200), point(8, 50), point(8, 80)]);
    expect(result.map(row => row.obv)).toEqual([0, 200, 150, 150]);
    expect(result.map(row => row.adl)).toEqual([0, 200, 150, 70]);
  });

  it('handles zero price ranges and empty history without NaN', () => {
    expect(calculateVolumeIndicators([])).toEqual([]);
    expect(calculateVolumeIndicators([point(10, 100, 10, 10)])[0]).toEqual({ date: '115/10/08', obv: 0, adl: 0 });
  });

  it('preserves cumulative values when a display range is cropped', () => {
    const result = calculateVolumeIndicators([point(10, 100), point(12, 200), point(8, 50)]);
    expect(result.slice(-1)[0].obv).toBe(150);
    expect(result.slice(-2).at(-1)?.adl).toBe(150);
  });
});
