import { StockHistoryPoint } from '../stock-price.service';
import { OrderType } from '../models/trade-position.model';
import { PortfolioCalculatorService } from './portfolio-calculator.service';

export interface PlannedTradeConfig {
  entry: number; stop?: number; target?: number; shares: number; type: OrderType;
  capital: number; feeDiscount: number; financingRate: number; borrowRate: number;
}

export function simulatePlannedTrade(history: StockHistoryPoint[], plan: PlannedTradeConfig, calculator = new PortfolioCalculatorService()) {
  const short = plan.type === '空單' || plan.type === '融券';
  const result = { status: '未進場', error: '', entryDate: '', entryPrice: 0, exitDate: '', exitPrice: 0,
    reason: '', profit: 0, costs: 0, maxDrawdown: 0, endingEquity: plan.capital, ambiguousDays: 0 };
  if (!(plan.entry > 0) || !Number.isInteger(plan.shares) || plan.shares <= 0 || !(plan.capital > 0) ||
      (plan.stop !== undefined && !(short ? plan.stop > plan.entry : plan.stop > 0 && plan.stop < plan.entry)) ||
      (plan.target !== undefined && !(short ? plan.target > 0 && plan.target < plan.entry : plan.target > plan.entry))) {
    return { ...result, error: '請先修正進場價、股數、資金與多空停損／目標方向。' };
  }
  const opening = calculator.tradeCosts(plan.entry, plan.entry, plan.type, plan.shares, 1, 0, 0, plan.feeDiscount);
  if (plan.entry * plan.shares + (short ? opening.sellFee + opening.transactionTax : opening.buyFee) > plan.capital) return { ...result, error: '模擬資金不足完整名目部位與進場費；此版本不使用保證金槓桿。' };
  let enteredIndex = -1, peak = plan.capital;
  const dayKey = (date: string) => {
    const [year, month, day] = date.split('/').map(Number);
    return Date.UTC(year < 1911 ? year + 1911 : year, month - 1, day);
  };
  for (let index = 0; index < history.length; index++) {
    const bar = history[index];
    if (enteredIndex < 0) {
      if (short ? bar.high < plan.entry : bar.low > plan.entry) continue;
      const fillsAtOpen = short ? bar.open >= plan.entry : bar.open <= plan.entry;
      if (fillsAtOpen && plan.stop !== undefined && (short ? bar.open >= plan.stop : bar.open <= plan.stop)) {
        return { ...result, status: '未進場（開盤越過停損）', reason: '進場日開盤已超出停損規劃，取消此筆模擬進場，避免假設回到停損價成交。' };
      }
      enteredIndex = index;
      result.entryDate = bar.date;
      result.entryPrice = short ? Math.max(bar.open, plan.entry) : Math.min(bar.open, plan.entry);
      result.status = '持倉中';
    }
    const stopHit = plan.stop !== undefined && (short ? bar.high >= plan.stop : bar.low <= plan.stop);
    const targetHit = plan.target !== undefined && (short ? bar.low <= plan.target : bar.high >= plan.target);
    let exit = bar.close;
    if (stopHit && targetHit) result.ambiguousDays++;
    // On entry day, use conservative whole-bar triggers: intraday order is unknown.
    const gapStop = index > enteredIndex && plan.stop !== undefined && (short ? bar.open >= plan.stop : bar.open <= plan.stop);
    const gapTarget = index > enteredIndex && plan.target !== undefined && (short ? bar.open <= plan.target : bar.open >= plan.target);
    if (gapStop || gapTarget) {
      exit = bar.open;
      result.reason = gapStop ? '跳空越過停損，按開盤價' : '跳空越過目標，按開盤價';
    } else if (stopHit) { exit = plan.stop!; result.reason = targetHit ? '同日雙觸發，停損優先' : '觸發停損'; }
    else if (targetHit) { exit = plan.target!; result.reason = '觸發目標'; }
    const days = Math.max(1, Math.round((dayKey(bar.date) - dayKey(result.entryDate)) / 86400000));
    result.profit = calculator.simulateOrder(result.entryPrice, exit, plan.type, plan.shares, days, plan.financingRate, plan.borrowRate, plan.feeDiscount);
    result.costs = calculator.tradeCosts(result.entryPrice, exit, plan.type, plan.shares, days, plan.financingRate, plan.borrowRate, plan.feeDiscount).total;
    result.endingEquity = plan.capital + result.profit;
    peak = Math.max(peak, result.endingEquity);
    result.maxDrawdown = Math.max(result.maxDrawdown, (peak - result.endingEquity) / peak * 100);
    if (stopHit || targetHit) {
      result.status = '已出場'; result.exitDate = bar.date; result.exitPrice = exit; break;
    }
    result.exitDate = bar.date; result.exitPrice = exit; result.reason = '區間末收盤估值（尚未平倉）';
  }
  return result;
}
