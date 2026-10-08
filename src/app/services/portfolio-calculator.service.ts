import { Injectable, signal } from '@angular/core';

import { BacktestResult, OrderScenario, OrderType, PositionGroup, TradeCostBreakdown, TradePosition } from '../models/trade-position.model';

@Injectable({ providedIn: 'root' })
export class PortfolioCalculatorService {
  readonly costSettings = signal({ feeRate: 0.001425, minimumFee: 0, taxRate: 0.003, financingLoanRatio: 0.4 });
  simulateOrder(
    entry: number,
    exit: number,
    type: OrderType,
    shares: number,
    holdingDays = 1,
    financingRate = 0,
    shortBorrowRate = 0,
    feeDiscount = 1,
  ): number {
    const costs = this.tradeCosts(entry, exit, type, shares, holdingDays, financingRate, shortBorrowRate, feeDiscount);
    const grossProfit = this.isShort(type) ? (entry - exit) * shares : (exit - entry) * shares;
    return grossProfit - costs.total;
  }

  tradeCosts(
    entry: number, exit: number, type: OrderType, shares: number, holdingDays = 1,
    financingRate = 0, shortBorrowRate = 0, feeDiscount = 1,
  ): TradeCostBreakdown {
    const entryTurnover = Math.max(entry * shares, 0);
    const exitTurnover = Math.max(exit * shares, 0);
    const settings = this.costSettings();
    const fee = (turnover: number) => shares > 0 ? Math.max(turnover * settings.feeRate * feeDiscount, settings.minimumFee) : 0;
    const buyFee = fee(this.isShort(type) ? exitTurnover : entryTurnover);
    const sellFee = fee(this.isShort(type) ? entryTurnover : exitTurnover);
    const transactionTax = (this.isShort(type) ? entryTurnover : exitTurnover) * settings.taxRate;
    const financingCost = type === '融資'
      ? entryTurnover * settings.financingLoanRatio * (financingRate / 100) * (holdingDays / 365) : 0;
    const borrowCost = type === '融券'
      ? entryTurnover * (shortBorrowRate / 100) * (holdingDays / 365) : 0;
    return {
      buyFee, sellFee, transactionTax, financingCost, borrowCost,
      total: buyFee + sellFee + transactionTax + financingCost + borrowCost,
    };
  }

  recommendedShares(entry: number, stopLoss: number, maxLoss: number, feeDiscount = 1): number {
    const riskPerShare = Math.abs(entry - stopLoss) + (entry + stopLoss) * 0.001425 * feeDiscount + stopLoss * 0.003;
    return riskPerShare > 0 ? Math.max(Math.floor(maxLoss / riskPerShare), 0) : 0;
  }
  positionExitCosts(position: TradePosition, exit: number, shares: number, days: number, financingRate: number, borrowRate: number, discount: number): TradeCostBreakdown {
    const costs = this.tradeCosts(position.entryPrice, exit, position.type, shares, days, financingRate, borrowRate, discount);
    const fraction = shares / position.shares;
    if (position.entryFeePaid !== undefined) {
      if (this.isShort(position.type)) costs.sellFee = position.entryFeePaid * fraction;
      else costs.buyFee = position.entryFeePaid * fraction;
    }
    if (this.isShort(position.type) && position.entryTaxPaid !== undefined) costs.transactionTax = position.entryTaxPaid * fraction;
    costs.total = costs.buyFee + costs.sellFee + costs.transactionTax + costs.financingCost + costs.borrowCost;
    return costs;
  }
  entryCapital(entry: number, type: OrderType, shares: number, discount: number): number {
    const costs = this.tradeCosts(entry, entry, type, shares, 1, 0, 0, discount);
    return entry * shares + (this.isShort(type) ? costs.sellFee + costs.transactionTax : costs.buyFee);
  }

  sizeByRiskAndCash(entry: number, stop: number, type: OrderType, maxLoss: number, cash: number, days: number, financingRate: number, borrowRate: number, discount: number): number {
    if (!(entry > 0) || !(stop > 0) || !(cash > 0) || !(maxLoss > 0)) return 0;
    let low = 0, high = Math.min(Math.floor(cash / entry), 1_000_000_000);
    while (low < high) {
      const shares = Math.ceil((low + high) / 2);
      const costs = this.tradeCosts(entry, stop, type, shares, days, financingRate, borrowRate, discount);
      const entryCosts = this.isShort(type) ? costs.sellFee + costs.transactionTax : costs.buyFee;
      const loss = -this.simulateOrder(entry, stop, type, shares, days, financingRate, borrowRate, discount);
      if (loss <= maxLoss && entry * shares + entryCosts <= cash) low = shares;
      else high = shares - 1;
    }
    return low;
  }

  backtest(prices: number[], type: OrderType, initialCapital = 100000): BacktestResult {
    if (prices.length < 2) return { observations: prices.length, totalReturn: 0, maxDrawdown: 0, winRate: 0, profitFactor: 0, endingEquity: initialCapital };
    let equity = initialCapital;
    let peak = initialCapital;
    let maxDrawdown = 0;
    let wins = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    for (let index = 1; index < prices.length; index++) {
      const rawReturn = prices[index - 1] > 0 ? (prices[index] - prices[index - 1]) / prices[index - 1] : 0;
      const dailyReturn = this.isShort(type) ? -rawReturn : rawReturn;
      const change = equity * dailyReturn;
      equity += change;
      if (change >= 0) { wins++; grossProfit += change; } else { grossLoss += Math.abs(change); }
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak * 100 : 0);
    }
    return {
      observations: prices.length,
      totalReturn: (equity - initialCapital) / initialCapital * 100,
      maxDrawdown,
      winRate: wins / (prices.length - 1) * 100,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
      endingEquity: equity,
    };
  }

  optimizeNearTermOrders(
    minPrice: number,
    maxPrice: number,
    currentPrice: number,
    shares: number,
    holdingDays: number,
    financingRate: number,
    shortBorrowRate: number,
  ): OrderScenario[] {
    const midpoint = (minPrice + maxPrice) / 2;
    const candidates: Array<{ type: OrderType; entry: number; exit: number; adverse: number; label: string }> = [
      { type: '現股多單', entry: minPrice, exit: maxPrice, adverse: minPrice, label: '回檔承接' },
      { type: '現股多單', entry: Math.min(currentPrice, midpoint), exit: maxPrice, adverse: minPrice, label: '現價偏多' },
      { type: '融資', entry: minPrice, exit: maxPrice, adverse: minPrice, label: '融資進取' },
      { type: '空單', entry: maxPrice, exit: minPrice, adverse: maxPrice, label: '高檔放空' },
      { type: '空單', entry: Math.max(currentPrice, midpoint), exit: minPrice, adverse: maxPrice, label: '現價偏空' },
      { type: '融券', entry: maxPrice, exit: minPrice, adverse: maxPrice, label: '融券進取' },
    ];

    return candidates.map((candidate) => {
      const projectedProfit = this.simulateOrder(candidate.entry, candidate.exit, candidate.type, shares, holdingDays, financingRate, shortBorrowRate);
      const adverseProfit = this.simulateOrder(candidate.entry, candidate.adverse, candidate.type, shares, holdingDays, financingRate, shortBorrowRate);
      return {
        type: candidate.type,
        entryPrice: Math.round(candidate.entry * 100) / 100,
        exitPrice: Math.round(candidate.exit * 100) / 100,
        projectedProfit,
        adverseProfit,
        returnRate: projectedProfit / Math.max(candidate.entry * shares, 1) * 100,
        label: candidate.label,
      };
    }).sort((left, right) => right.projectedProfit - left.projectedProfit);
  }

  positionCost(position: TradePosition): number {
    return position.entryPrice * position.shares;
  }

  positionMarketValue(position: TradePosition, currentPrice: number): number {
    return currentPrice * position.shares;
  }

  holdingDays(start: string | undefined, end: string): number {
    if (!start) return 1;
    return Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000));
  }
  positionProfit(position: TradePosition, currentPrice: number, feeDiscount = 1, days = 1, financingRate = 0, borrowRate = 0, shares = position.shares): number {
    const costs = this.positionExitCosts(position, currentPrice, shares, days, financingRate, borrowRate, feeDiscount);
    const gross = (this.isShort(position.type) ? position.entryPrice - currentPrice : currentPrice - position.entryPrice) * shares;
    return gross - costs.total;
  }

  groupPositions(positions: TradePosition[], marketPrice: (symbol: string) => number, feeDiscount = 1, asOfDate?: string, financingRate = 0, borrowRate = 0): PositionGroup[] {
    const groups = new Map<string, TradePosition[]>();
    for (const position of positions) {
      groups.set(position.symbol, [...(groups.get(position.symbol) ?? []), position]);
    }

    return Array.from(groups, ([symbol, groupedPositions]) => ({
      symbol,
      positions: groupedPositions,
      shares: groupedPositions.reduce((sum, position) => sum + position.shares, 0),
      cost: groupedPositions.reduce((sum, position) => sum + this.positionCost(position), 0),
      profit: groupedPositions.reduce(
        (sum, position) => sum + this.positionProfit(position, marketPrice(symbol), feeDiscount, asOfDate ? this.holdingDays(position.tradeDate, asOfDate) : 1, financingRate, borrowRate),
        0,
      ),
    }));
  }

  private isShort(type: OrderType): boolean {
    return type === '空單' || type === '融券';
  }
}
