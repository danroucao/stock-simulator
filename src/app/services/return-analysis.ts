import { StockHistoryPoint } from '../stock-price.service';

export function compareDailyReturns(stock: StockHistoryPoint[], benchmark: StockHistoryPoint[]) {
  const returns = (rows: StockHistoryPoint[]) => new Map(rows.slice(1).filter((row, i) => row.close > 0 && rows[i].close > 0).map(row => {
    const index = rows.indexOf(row);
    return [`${rows[index - 1].date}:${row.date}`, row.close / rows[index - 1].close - 1] as const;
  }));
  const left = returns(stock), right = returns(benchmark);
  const pairs = [...left].filter(([key]) => right.has(key)).map(([key, value]) => [value, right.get(key)!]);
  if (pairs.length < 30) return { observations: pairs.length, correlation: null, beta: null };
  const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let covariance = 0, varianceX = 0, varianceY = 0;
  for (const [x, y] of pairs) { covariance += (x - meanX) * (y - meanY); varianceX += (x - meanX) ** 2; varianceY += (y - meanY) ** 2; }
  return { observations: pairs.length, correlation: varianceX > 0 && varianceY > 0 ? covariance / Math.sqrt(varianceX * varianceY) : null, beta: varianceY > 0 ? covariance / varianceY : null };
}
