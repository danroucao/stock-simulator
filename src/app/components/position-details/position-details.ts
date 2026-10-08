import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, input, output, signal } from '@angular/core';

import { PositionInlineChange, TradePosition } from '../../models/trade-position.model';
import { PortfolioCalculatorService } from '../../services/portfolio-calculator.service';

@Component({
  selector: 'app-position-details',
  imports: [DecimalPipe],
  templateUrl: './position-details.html',
  styleUrl: './position-details.scss',
})
export class PositionDetails {
  readonly positions = input.required<TradePosition[]>();
  readonly currentSymbol = input.required<string>();
  readonly latestPrice = input.required<number>();
  readonly quoteUpdating = input(false);
  readonly fallbackPrice = input.required<number>();
  readonly pricesBySymbol = input<Record<string, number>>({});
  readonly feeDiscount = input(1);
  readonly asOfDate = input(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date()));
  readonly financingRate = input(0);
  readonly borrowRate = input(0);
  readonly positionChange = output<PositionInlineChange>();
  readonly positionClose = output<TradePosition>();
  readonly positionDelete = output<string>();
  readonly positionGroupDelete = output<string>();

  protected readonly expandedSymbols = signal<Set<string>>(new Set());
  protected readonly pendingDeleteSymbol = signal<string | null>(null);
  protected readonly pendingDeletePositionId = signal<string | null>(null);
  protected readonly groups = computed(() =>
    this.calculator.groupPositions(this.positions(), (symbol) => this.marketPriceFor(symbol), this.feeDiscount(), this.asOfDate(), this.financingRate(), this.borrowRate()),
  );

  constructor(private readonly calculator: PortfolioCalculatorService) {
    effect(() => {
      const symbol = this.currentSymbol();
      if (symbol) this.expandedSymbols.set(new Set([symbol]));
    });
  }

  protected toggle(symbol: string): void {
    const next = new Set(this.expandedSymbols());
    next.has(symbol) ? next.delete(symbol) : next.add(symbol);
    this.expandedSymbols.set(next);
  }

  protected update(id: string, field: 'note' | 'targetPrice' | 'stopLossPrice', value: string | number): void {
    this.positionChange.emit({ id, field, value });
  }

  protected requestGroupDelete(symbol: string): void {
    this.pendingDeleteSymbol.set(symbol);
  }

  protected cancelGroupDelete(): void {
    this.pendingDeleteSymbol.set(null);
  }

  protected confirmGroupDelete(symbol: string): void {
    this.positionGroupDelete.emit(symbol);
    this.pendingDeleteSymbol.set(null);
  }

  protected requestPositionDelete(id: string): void {
    this.pendingDeletePositionId.set(id);
  }

  protected cancelPositionDelete(): void {
    this.pendingDeletePositionId.set(null);
  }

  protected confirmPositionDelete(id: string): void {
    this.positionDelete.emit(id);
    this.pendingDeletePositionId.set(null);
  }

  protected marketPriceFor(symbol: string): number {
    const recordedPrice = this.pricesBySymbol()[symbol];
    if (recordedPrice > 0) return recordedPrice;
    if (symbol === this.currentSymbol() && this.latestPrice() > 0) return this.latestPrice();
    const positions = this.positions().filter(position => position.symbol === symbol);
    const shares = positions.reduce((sum, position) => sum + position.shares, 0);
    return shares > 0 ? positions.reduce((sum, position) => sum + position.entryPrice * position.shares, 0) / shares : 0;
  }

  protected hasQuote(symbol: string): boolean {
    return this.pricesBySymbol()[symbol] > 0 || (symbol === this.currentSymbol() && this.latestPrice() > 0);
  }

  protected cost(position: TradePosition): number {
    return this.calculator.positionCost(position);
  }

  protected marketValue(position: TradePosition): number {
    return this.calculator.positionMarketValue(position, this.marketPriceFor(position.symbol));
  }

  protected profit(position: TradePosition): number {
    return this.calculator.positionProfit(position, this.marketPriceFor(position.symbol), this.feeDiscount(), this.calculator.holdingDays(position.tradeDate, this.asOfDate()), this.financingRate(), this.borrowRate());
  }
}
