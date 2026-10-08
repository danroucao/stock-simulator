import { StockHistoryPoint } from '../stock-price.service';

export interface VolumeIndicatorPoint {
  date: string;
  obv: number;
  adl: number;
}

// Input is chronological; OBV starts at zero on the first available session.
export function calculateVolumeIndicators(history: StockHistoryPoint[]): VolumeIndicatorPoint[] {
  let obv = 0;
  let adl = 0;
  return history.map((point, index) => {
    if (index > 0) {
      obv += Math.sign(point.close - history[index - 1].close) * point.volume;
    }
    if (point.high > point.low) {
      adl += ((2 * point.close - point.high - point.low) / (point.high - point.low)) * point.volume;
    }
    return { date: point.date, obv, adl };
  });
}
