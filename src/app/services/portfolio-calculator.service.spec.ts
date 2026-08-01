import { TestBed } from '@angular/core/testing';

import { TradePosition } from '../models/trade-position.model';
import { PortfolioCalculatorService } from './portfolio-calculator.service';

describe('PortfolioCalculatorService', () => {
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
