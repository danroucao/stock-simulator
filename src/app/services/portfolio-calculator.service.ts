import { Injectable } from '@angular/core';

import { BacktestResult, OrderScenario, OrderType, PositionGroup, TradeCostBreakdown, TradePosition } from '../models/trade-position.model';

@Injectable({ providedIn: 'root' })
export class PortfolioCalculatorService {
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
    const buyFee = entryTurnover * 0.001425 * feeDiscount;
    const sellFee = exitTurnover * 0.001425 * feeDiscount;
    const transactionTax = (this.isShort(type) ? entryTurnover : exitTurnover) * 0.003;
    const financingCost = type === '融資'
      ? entryTurnover * 0.4 * (financingRate / 100) * (holdingDays / 365) : 0;
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

  positionProfit(position: TradePosition, currentPrice: number, feeDiscount = 1): number {
    return this.simulateOrder(position.entryPrice, currentPrice, position.type, position.shares, 1, 0, 0, feeDiscount);
  }

  groupPositions(positions: TradePosition[], marketPrice: (symbol: string) => number, feeDiscount = 1): PositionGroup[] {
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
        (sum, position) => sum + this.positionProfit(position, marketPrice(symbol), feeDiscount),
        0,
      ),
    }));
  }

  private isShort(type: OrderType): boolean {
    return type === '空單' || type === '融券';
  }
}
