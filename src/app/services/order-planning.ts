import { OrderType, PresetOrder } from '../models/trade-position.model';
import { PortfolioCalculatorService } from './portfolio-calculator.service';

export function validDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function plannedDateError(tradingDate: string, expiry: string): string {
  if (!validDate(tradingDate) || !validDate(expiry)) return '請輸入有效的預計交易日與有效至日期。';
  return tradingDate > expiry ? '預計交易日不可晚於有效至。' : '';
}
export function pendingOrderStatus(order: PresetOrder, today: string, partial: boolean): string {
  if (order.expiryDate && order.expiryDate < today) return '已過期';
  if (partial) return '部分成交';
  if (order.plannedTradeDate && order.plannedTradeDate > today) return '尚未到交易日';
  return '待成交';
}
export interface PlanningInput {
  entry: number; shares: number; type: OrderType; target?: number; stop?: number;
  days: number; discount: number; financingRate: number; borrowRate: number;
}
// Keep full precision throughout; UI rounds only the final amount to whole TWD.
export function estimatePlan(input: PlanningInput, calculator: PortfolioCalculatorService) {
  const { entry, shares, type, target, stop, days, discount, financingRate, borrowRate } = input;
  const short = type === '空單' || type === '融券';
  if (![entry, shares, days, discount, financingRate, borrowRate].every(Number.isFinite) ||
    entry <= 0 || !Number.isInteger(shares) || shares <= 0 || !Number.isInteger(days) || days < 1 ||
    discount < 0 || discount > 1 || financingRate < 0 || borrowRate < 0 ||
    !['現股多單', '融資', '空單', '融券'].includes(type) ||
    (stop !== undefined && (!Number.isFinite(stop) || stop <= 0 || (short ? stop <= entry : stop >= entry))) ||
    (target !== undefined && (!Number.isFinite(target) || target <= 0 || (short ? target >= entry : target <= entry)))) return null;
  const net = (exit: number) => calculator.simulateOrder(entry, exit, type, shares, days, financingRate, borrowRate, discount);
  const reward = target === undefined ? null : net(target);
  const risk = stop === undefined ? null : Math.max(0, -net(stop));
  return { reward, risk, ratio: risk !== null && risk > 0 && reward !== null ? reward / risk : null,
    gross: target === undefined ? null : (short ? entry - target : target - entry) * shares,
    costs: target === undefined ? null : calculator.tradeCosts(entry, target, type, shares, days, financingRate, borrowRate, discount) };
}
