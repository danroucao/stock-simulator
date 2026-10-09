import { AlertFeed, AlertStock } from './market-alerts';

export function exclusionSummary(feed: AlertFeed) {
  const counts = { price:0, history:0, liquidity:0, missing:0 };
  for (const stock of feed.stocks.filter(s=>!s.eligible)) {
    const reason=stock.exclusion || stock.reason;
    if(reason.includes('價格基準')) counts.price++;
    else if(reason.includes('歷史不足')) counts.history++;
    else if(/流動性|無成交/.test(reason)) counts.liquidity++;
    else counts.missing++;
  }
  counts.missing += Math.max(0,feed.universeCount-feed.stocks.length);
  return counts;
}
export function upperDistance(stock: AlertStock): number | undefined {
  return stock.eligible && stock.upper && stock.close>0 && stock.close<=stock.upper ? (stock.upper/stock.close-1)*100 : undefined;
}
