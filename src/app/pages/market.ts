import { Component, computed, inject, afterNextRender, Injector, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MarketStore } from '../services/market-store';
import { amount } from '../services/market-presentation';

@Component({
  selector: 'app-market',
  imports: [DecimalPipe, RouterLink],
  styleUrl: './market-pages.scss',
  templateUrl: './market.html',
})
export class MarketPage {
  readonly store = inject(MarketStore);
  readonly sort = this.store.heatSort;
  readonly query = signal('');
  readonly expanded = signal(false);
  readonly diagnosticQuery = signal('');
  readonly diagnosticLimit = signal(20);
  readonly excluded = computed(() =>
    (this.store.feed()?.heatComparison?.excluded || []).filter((s) =>
      (s.symbol + ' ' + s.name + ' ' + s.industry).includes(this.diagnosticQuery().trim()),
    ),
  );
  readonly visibleExcluded = computed(() => this.excluded().slice(0, this.diagnosticLimit()));
  readonly amount = amount;
  readonly comparable = computed(
    () => this.store.feed()?.industryHeat.some((i) => i.changePoints !== null) || false,
  );
  readonly effectiveSort = computed(() => (this.comparable() ? this.sort() : 'turnover'));
  readonly rows = computed(() =>
    [...(this.store.feed()?.industryHeat || [])]
      .filter((i) => i.industry.includes(this.query().trim()))
      .sort((a, b) =>
        this.effectiveSort() === 'turnover'
          ? b.turnover - a.turnover
          : a.changePoints === null
            ? b.changePoints === null
              ? b.turnover - a.turnover
              : 1
            : b.changePoints === null
              ? -1
              : (a.changePoints - b.changePoints) * (this.effectiveSort() === 'increase' ? -1 : 1),
      ),
  );
  readonly bars = computed(() =>
    [...this.rows()]
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, this.expanded() ? Infinity : 10),
  );
  readonly concentrated = computed(
    () => [...(this.store.feed()?.industryHeat || [])].sort((a, b) => b.turnover - a.turnover)[0],
  );
  readonly increased = computed(
    () =>
      this.store
        .feed()
        ?.industryHeat.filter((i) => i.changePoints !== null && i.changePoints > 0)
        .sort((a, b) => b.changePoints! - a.changePoints!)[0],
  );
  readonly decreased = computed(
    () =>
      this.store
        .feed()
        ?.industryHeat.filter((i) => i.changePoints !== null && i.changePoints < 0)
        .sort((a, b) => a.changePoints! - b.changePoints!)[0],
  );
  private injector = inject(Injector);
  private readonly onHide = () => {
    this.store.marketScroll = window.scrollY;
    try {
      sessionStorage.setItem(
        'stock-market-view-v1',
        JSON.stringify({
          sort: this.sort(),
          scroll: this.store.marketScroll,
          query: this.query(),
          expanded: this.expanded(),
        }),
      );
    } catch {}
  };
  constructor() {
    try {
      const view = JSON.parse(sessionStorage.getItem('stock-market-view-v1') || 'null');
      if (view) {
        if (['turnover', 'increase', 'decrease'].includes(view.sort)) this.sort.set(view.sort);
        this.store.marketScroll = Math.max(0, view.scroll || 0);
        this.query.set(typeof view.query === 'string' ? view.query : '');
        this.expanded.set(view.expanded === true);
      }
    } catch {}
    window.addEventListener('pagehide', this.onHide);
    void this.store.load();
    afterNextRender(() => window.scrollTo(0, this.store.marketScroll), { injector: this.injector });
  }
  ngOnDestroy(): void {
    this.onHide();
    window.removeEventListener('pagehide', this.onHide);
  }
}
