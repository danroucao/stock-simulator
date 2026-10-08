import { TestBed } from '@angular/core/testing';

import { TradePosition } from '../models/trade-position.model';
import { PortfolioCalculatorService } from './portfolio-calculator.service';

describe('PortfolioCalculatorService', () => {
  it('uses remaining allocated entry cost for unrealized profit and grouped totals', () => {
    const calculator = new PortfolioCalculatorService();
    calculator.costSettings.update(settings => ({ ...settings, minimumFee: 20 }));
    const position: TradePosition = { id: 'remaining', symbol: '2330', type: '現股多單', shares: 60, entryPrice: 10, targetPrice: 11, note: '', entryFeePaid: 12 };
    const profit = calculator.positionProfit(position, 11);
    expect(profit).toBeCloseTo(60 - 12 - 20 - 660 * .003);
    expect(calculator.groupPositions([position], () => 11)[0].profit).toBe(profit);
  });
  it('allocates an existing entry fee across partial closes instead of charging a new minimum each time', () => {
    const calculator = new PortfolioCalculatorService();
    calculator.costSettings.update(settings => ({ ...settings, minimumFee: 20 }));
    const position: TradePosition = { id: 'allocated', symbol: '2330', type: '現股多單', shares: 100, entryPrice: 10, targetPrice: 11, note: '', entryFeePaid: 20, entryTaxPaid: 0 };
    const first = calculator.positionExitCosts(position, 11, 40, 1, 0, 0, 1);
    expect(first.buyFee).toBe(8);
    expect(first.sellFee).toBe(20);
    const remaining = { ...position, shares: 60, entryFeePaid: 12 };
    const second = calculator.positionExitCosts(remaining, 11, 60, 1, 0, 0, 1);
    expect(first.buyFee + second.buyFee).toBe(20);
    expect(second.sellFee).toBe(20);
  });
  it('applies minimum fees and sizes within both loss and cash budgets', () => {
    const calculator = new PortfolioCalculatorService();
    calculator.costSettings.update(settings => ({ ...settings, minimumFee: 20 }));
    expect(calculator.tradeCosts(100, 95, '現股多單', 1).buyFee).toBe(20);
    const shares = calculator.sizeByRiskAndCash(100, 95, '現股多單', 100, 10000, 1, 0, 0, 1);
    expect(-calculator.simulateOrder(100, 95, '現股多單', shares)).toBeLessThanOrEqual(100);
    expect(-calculator.simulateOrder(100, 95, '現股多單', shares + 1)).toBeGreaterThan(100);
    expect(calculator.sizeByRiskAndCash(100, 95, '現股多單', 1000, 119, 1, 0, 0, 1)).toBe(0);
  });
  let service: PortfolioCalculatorService;
  const longPosition: TradePosition = {
    id: 'long', symbol: '2330', type: '現股多單', shares: 100,
    entryPrice: 600, targetPrice: 700, note: '',
  };
  const shortPosition: TradePosition = {
    id: 'short', symbol: '2330', type: '空單', shares: 50,
    entryPrice: 680, targetPrice: 600, note: '',
  };

  beforeEach(() => {
    service = TestBed.inject(PortfolioCalculatorService);
  });

  it('calculates long and short profit by direction', () => {
    expect(service.positionProfit(longPosition, 650)).toBeCloseTo(4626.875);
    expect(service.positionProfit(shortPosition, 650)).toBeCloseTo(1303.2375);
  });

  it('groups positions and aggregates cost, shares and profit', () => {
    const [group] = service.groupPositions([longPosition, shortPosition], () => 650);
    expect(group.symbol).toBe('2330');
    expect(group.shares).toBe(150);
    expect(group.cost).toBe(94000);
    expect(group.profit).toBeCloseTo(5930.1125);
  });

  it('recommends position size from maximum loss and stop price', () => {
    expect(service.recommendedShares(100, 90, 10_000)).toBeGreaterThan(900);
    expect(service.recommendedShares(100, 90, 10_000)).toBeLessThan(1000);
  });

  it('backtests a price series and reports drawdown', () => {
    const result = service.backtest([100, 110, 88, 96.8], '現股多單', 100_000);
    expect(result.totalReturn).toBeCloseTo(-3.2);
    expect(result.maxDrawdown).toBeCloseTo(20);
    expect(result.observations).toBe(4);
  });

  it('ranks near-term order scenarios by projected net profit', () => {
    const scenarios = service.optimizeNearTermOrders(600, 700, 650, 100, 5, 4.5, 3.2);
    expect(scenarios.length).toBe(6);
    expect(scenarios[0].projectedProfit).toBeGreaterThanOrEqual(scenarios[1].projectedProfit);
    expect(scenarios.every((scenario) => scenario.entryPrice >= 600 && scenario.entryPrice <= 700)).toBe(true);
  });
});
