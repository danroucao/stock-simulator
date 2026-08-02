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
  readonly fallbackPrice = input.required<number>();
  readonly pricesBySymbol = input<Record<string, number>>({});
  readonly feeDiscount = input(1);
  readonly positionChange = output<PositionInlineChange>();
  readonly positionClose = output<TradePosition>();
  readonly positionGroupDelete = output<string>();

  protected readonly expandedSymbols = signal<Set<string>>(new Set());
  protected readonly pendingDeleteSymbol = signal<string | null>(null);
  protected readonly groups = computed(() =>
    this.calculator.groupPositions(this.positions(), (symbol) => this.marketPriceFor(symbol), this.feeDiscount()),
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

  protected marketPriceFor(symbol: string): number {
    const recordedPrice = this.pricesBySymbol()[symbol];
    if (recordedPrice > 0) return recordedPrice;
    return symbol === this.currentSymbol() && this.latestPrice() > 0 ? this.latestPrice() : this.fallbackPrice();
  }

  protected cost(position: TradePosition): number {
    return this.calculator.positionCost(position);
  }

  protected marketValue(position: TradePosition): number {
    return this.calculator.positionMarketValue(position, this.marketPriceFor(position.symbol));
  }

  protected profit(position: TradePosition): number {
    return this.calculator.positionProfit(position, this.marketPriceFor(position.symbol), this.feeDiscount());
  }
}
