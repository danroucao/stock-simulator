import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
afterEach(() => vi.useRealTimers());

import { App } from './app';
import { StockPriceService } from './stock-price.service';

describe('App', () => {
  it('reserves fees for pending entries and rejects invalid financial inputs', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.presetOrders.set([{ id: 'reserve-fee', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, validDays: 1, createdAt: app.todayDate(), expiryDate: app.todayDate() }]);
    expect(app.pendingOrderCapital()).toBeCloseTo(100085.5);
    const cash = app.availableCash();
    app.updateNumericSetting('availableCash', '-1');
    expect(app.availableCash()).toBe(cash);
    app.updateNumericSetting('feeDiscount', '1.2');
    expect(app.feeDiscount()).toBe(.6);
    app.updateNumericSetting('cashOpeningBalance', 'Infinity');
    expect(Number.isFinite(app.cashOpeningBalance())).toBe(true);
    app.updateNumericSetting('availableCash', '123456');
    expect(app.availableCash()).toBe(123456);
    expect(app.numericSettingsError()).toBe('');
  });
  it('tracks only new cash-equity executions and restores cash movements on undo', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.tradePositions.set([]);
    app.cashOpeningBalance.set(100000);
    app.cashTrackingEnabled.set(true);
    const order = { id: 'cash-buy', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, validDays: 1, createdAt: app.todayDate(), expiryDate: app.todayDate() };
    app.presetOrders.set([order]);
    app.startPresetFill(order);
    app.fillShares.set(400);
    app.confirmPresetFill();
    expect(app.cashMovements().length).toBe(1);
    expect(app.trackedCashBalance()).toBeCloseTo(100000 - 40000 - 34.2);
    const planningCash = app.availableCash();
    app.closeTradePosition(app.tradePositions()[0]);
    app.closingPrice.set(110);
    app.closingShares.set(200);
    app.confirmPositionClose();
    expect(app.cashMovements().length).toBe(2);
    expect(app.trackedCashBalance()).toBeCloseTo(100000 - 40000 - 34.2 + 22000 - 18.81 - 66);
    expect(app.availableCash()).toBe(planningCash);
    app.confirmUndoTrade.set(true);
    app.undoLastTradeRecord();
    expect(app.cashMovements().length).toBe(1);
    expect(app.trackedCashBalance()).toBeCloseTo(59965.8);
  });
  it('undoes a partial close including realized profit and blocks undo after later edits', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const position = { id: 'undo', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, targetPrice: 110, tradeDate: '2026-01-01', note: '' };
    app.tradePositions.set([position]);
    app.closeTradePosition(position);
    app.closingPrice.set(110);
    app.closingShares.set(400);
    app.confirmPositionClose();
    expect(app.canUndoTrade()).toBe(true);
    app.confirmUndoTrade.set(true);
    app.undoLastTradeRecord();
    expect(app.tradePositions()[0].shares).toBe(1000);
    expect(app.closedTrades().length).toBe(0);
    app.closeTradePosition(app.tradePositions()[0]);
    app.closingPrice.set(110);
    app.confirmPositionClose();
    app.tradePositions.set([position]);
    expect(app.canUndoTrade()).toBe(false);
    app.confirmUndoTrade.set(true);
    app.undoLastTradeRecord();
    expect(app.closedTrades().length).toBe(1);
  });
  it('does not overwrite another tab data during a manual save', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.saveWorkspace();
    const other = JSON.parse(localStorage.getItem('stock-simulator-workspace-v1')!);
    other.availableCash = 777777;
    localStorage.setItem('stock-simulator-workspace-v1', JSON.stringify(other));
    app.availableCash.set(123456);
    app.saveWorkspace();
    expect(app.storageConflict()).toBe(true);
    expect(app.autoSaveEnabled()).toBe(false);
    expect(JSON.parse(localStorage.getItem('stock-simulator-workspace-v1')!).availableCash).toBe(777777);
    app.useOtherTabWorkspace();
    expect(app.availableCash()).toBe(777777);
    expect(app.storageConflict()).toBe(false);
  });

  it('recomputes expired orders when Taipei day changes while preserving historical queries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T15:59:00Z'));
    const fixture = TestBed.createComponent(App);
    try {
      const app = fixture.componentInstance as any;
      const order = { id: 'day', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, validDays: 1, createdAt: '2026-10-08', expiryDate: '2026-10-08' };
      app.presetOrders.set([order]);
      app.requestedDate.set('2026-09-01');
      expect(app.pendingOrderCapital()).toBe(100085.5);
      vi.setSystemTime(new Date('2026-10-08T16:01:00Z'));
      app.refreshCalendar();
      expect(app.todayDate()).toBe('2026-10-09');
      expect(app.pendingOrderCapital()).toBe(0);
      expect(app.requestedDate()).toBe('2026-09-01');
    } finally { fixture.destroy(); vi.useRealTimers(); }
  });
  it('retains canceled orders outside active planning and saves their history', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.presetOrders.set([{ id: 'cancel-history', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, validDays: 1, createdAt: app.todayDate() }]);
    app.removePresetOrder('cancel-history');
    app.removePresetOrder('cancel-history');
    expect(app.presetOrders().length).toBe(0);
    expect(app.archivedPresetOrders().length).toBe(1);
    expect(app.orderHistory()[0].status).toBe('取消');
    app.saveWorkspace();
    expect(JSON.parse(localStorage.getItem('stock-simulator-workspace-v1')!).archivedPresetOrders.length).toBe(1);
  });

  it('stores per-stock alerts and refuses inverted thresholds', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.updatePriceAlert('lower', '100');
    app.updatePriceAlert('upper', '90');
    expect(app.priceAlertError()).toBeTruthy();
    expect(app.currentPriceAlert().upper).toBeUndefined();
    app.latestPrice.set(99);
    expect(app.priceAlertMessage()).toContain('下限');
    app.stockSymbol.set('6182');
    expect(app.currentPriceAlert()).toEqual({});
  });
  it('never values an unquoted stock with another stock price', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.tradePositions.set([{ id: 'unquoted', symbol: '6182', type: '現股多單', shares: 1000, entryPrice: 100, targetPrice: 110, note: '' }]);
    app.latestPrices.set({ '2330': 2550 });
    app.selectedPrice.set(2550);
    expect(app.marketPriceForSymbol('6182')).toBe(100);
    expect(app.estimatedPriceSymbols()).toEqual(['6182']);
    expect(app.portfolioExposure().gross).toBe(100000);
  });
  it('uses each stock price for portfolio stress and flags missing quotes', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.tradePositions.set([
      { id: 'a', symbol: '2330', type: '現股多單', shares: 100, entryPrice: 100, targetPrice: 100, note: '' },
      { id: 'b', symbol: '6182', type: '空單', shares: 100, entryPrice: 50, targetPrice: 50, note: '' },
      { id: 'c', symbol: '2317', type: '現股多單', shares: 100, entryPrice: 80, targetPrice: 80, note: '' },
    ]);
    app.latestPrices.set({ '2330': 100, '6182': 50 });
    const portfolio = app.portfolioStress();
    expect(portfolio.missing).toEqual(['2317']);
    expect(portfolio.count).toBe(2);
    const scenario = portfolio.scenarios[0];
    expect(scenario.rows[0].scenario.scenarioPrice).toBe(90);
    expect(scenario.rows[1].scenario.scenarioPrice).toBe(45);
    expect(scenario.total).toBeCloseTo(scenario.rows.reduce((sum: number, row: any) => sum + row.scenario.totalProfit, 0));
    expect(scenario.exposure).toBe(13500);
  });
  it('restores a validated backup and preserves the previous workspace for recovery', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const saved = JSON.parse(app.workspaceBackupJson());
    saved.availableCash = 123456;
    app.importPreview.set({ raw: JSON.stringify(saved), filename: 'backup.json', positions: 0, orders: 0, fills: 0, stocks: 0 });
    const previous = app.availableCash();
    app.confirmWorkspaceImport();
    expect(app.availableCash()).toBe(123456);
    expect(JSON.parse(localStorage.getItem('stock-simulator-workspace-v1-before-import')!).availableCash).toBe(previous);
    app.previewBeforeImportBackup();
    expect(app.importPreview().filename).toBe('還原前自動備份');
  });
  it('reserves same-type sell quantities and excludes the order being edited', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.tradePositions.set([{ id: 'held', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, targetPrice: 110, note: '' }]);
    const sell = { id: 'reserved', symbol: '2330', type: '現股多單', action: 'sell', shares: 600, entryPrice: 110, validDays: 1, createdAt: app.todayDate(), expiryDate: app.todayDate() };
    app.presetOrders.set([sell]);
    app.changeOrderMode('preset');
    app.presetOrderAction.set('sell');
    app.shareUnit.set('oddLot');
    app.positionForm.update((form: any) => ({ ...form, type: '現股多單', shares: 500 }));
    expect(app.availableSellOrderShares()).toBe(400);
    app.createPresetOrderFromForm();
    expect(app.presetOrders().length).toBe(1);
    app.editPresetOrder(sell);
    expect(app.availableSellOrderShares()).toBe(1000);
    app.tradePositions.set([]);
    expect(app.oversubscribedSellOrders()[0].reserved).toBe(600);
  });
  it('removes a stopped holding from scenario exposure and does not sell it twice', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.latestPrice.set(100);
    app.tradePositions.set([{ id: 'stopped', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, stopLossPrice: 95, targetPrice: 120, note: '' }]);
    app.presetOrders.set([{ id: 'sale', symbol: '2330', type: '現股多單', action: 'sell', shares: 1000, entryPrice: 85, validDays: 1, createdAt: app.todayDate(), expiryDate: app.todayDate() }]);
    const scenario = app.buildStockStressScenario('test', 'test', 'test', -0.1, true);
    expect(scenario.stressedExposure).toBe(0);
    expect(scenario.details[0].remaining).toBe(0);
    expect(scenario.details.length).toBe(1);
    expect(scenario.presetProfit).toBe(0);
    const gap = app.buildStockStressScenario('gap', 'gap', 'gap', -0.1, false);
    expect(gap.details.some((row: any) => row.label.includes('賣出預設單'))).toBe(true);
  });

  it('excludes a new preset position after its target is reached', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.latestPrice.set(100);
    app.tradePositions.set([]);
    app.presetOrders.set([{ id: 'entry', symbol: '2330', type: '現股多單', action: 'buy', shares: 1000, entryPrice: 100, exitPrice: 110, validDays: 1, createdAt: app.todayDate(), expiryDate: app.todayDate() }]);
    const scenario = app.buildStockStressScenario('test', 'test', 'test', 0.1, true);
    expect(scenario.stressedExposure).toBe(0);
    expect(scenario.details[0].remaining).toBe(0);
    expect(scenario.details[0].contribution).toBeCloseTo(scenario.totalProfit);
  });
  it('reconciles stress detail contributions with each scenario total', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    for (const scenario of app.stressScenarios()) {
      expect(scenario.details.reduce((sum: number, row: any) => sum + row.contribution, 0)).toBeCloseTo(scenario.totalProfit);
      expect(Number.isFinite(scenario.changeFromNow)).toBe(true);
    }
  });
  it('previews a partial close and commits only the confirmed quantity', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const position = { id: 'partial-close', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, targetPrice: 110, tradeDate: '2026-01-01', note: '' };
    app.tradePositions.set([position]);
    app.closeTradePosition(position);
    expect(app.closedTrades().length).toBe(0);
    app.closingPrice.set(110);
    app.closingShares.set(400);
    app.closingDate.set('2026-02-01');
    const net = app.closingPreview().net;
    app.confirmPositionClose();
    expect(app.tradePositions()[0].shares).toBe(600);
    expect(app.closedTrades()[0].shares).toBe(400);
    expect(app.closedTrades()[0].realizedProfit).toBe(net);
    const snapshot = JSON.stringify(app.closedTrades()[0].costBreakdown);
    app.updateCostModel('minimumFee', '100');
    app.feeDiscount.set(1);
    expect(JSON.stringify(app.closedTrades()[0].costBreakdown)).toBe(snapshot);
    expect(app.closedTrades()[0].costAssumptions.minimumFee).toBe(0);
    expect(app.closedTrades()[0].realizedProfit).toBe(net);
    app.confirmPositionClose();
    expect(app.closedTrades().length).toBe(1);
  });

  it('uses cover terminology and rejects oversize close quantities', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const position = { id: 'cover', symbol: '2330', type: '空單', shares: 100, entryPrice: 100, targetPrice: 90, tradeDate: '2026-01-01', note: '' };
    app.tradePositions.set([position]);
    app.closeTradePosition(position);
    app.closingShares.set(101);
    app.closingPrice.set(90);
    app.confirmPositionClose();
    expect(app.tradePositions()[0].shares).toBe(100);
    app.closingShares.set(100);
    app.confirmPositionClose();
    expect(app.closingStatus()).toContain('回補');
    expect(app.tradePositions().length).toBe(0);
    expect(app.closedTrades()[0].realizedProfit).toBeGreaterThan(0);
  });
  it('rejects stops on the wrong side when changing direction', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.changeOrderMode('preset');
    app.positionForm.update((form: any) => ({ ...form, type: '空單', entryPrice: 100, targetPrice: 90, stopLossPrice: 95 }));
    expect(app.pricePlanningError()).toContain('高於');
    expect(app.proposedOrderRisk()).toBeNull();
    app.createPresetOrderFromForm();
    expect(app.presetOrders().length).toBe(0);
    app.onPositionFieldChange('stopLossPrice', 105);
    expect(app.pricePlanningError()).toBe('');
    expect(app.proposedOrderRisk()).toBeGreaterThan(5000);
  });

  it('never forces an unaffordable board lot when risk budget allows less than one lot', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.changeOrderMode('preset');
    app.positionForm.update((form: any) => ({ ...form, entryPrice: 100, targetPrice: 110, stopLossPrice: 90, shares: 1000 }));
    app.maxRiskPerTrade.set(1000);
    app.availableCash.set(1000000);
    expect(app.suggestedRiskShares()).toBe(0);
    app.applySuggestedShares();
    expect(app.positionForm().shares).toBe(1000);
    app.onShareUnitChange('oddLot');
    expect(app.suggestedRiskShares()).toBeGreaterThan(0);
    expect(app.suggestedRiskShares()).toBeLessThan(100);
    app.applySuggestedShares();
    expect(app.proposedOrderRisk()).toBeLessThanOrEqual(1000);
  });

  it('separates gross exposure from net exposure for long and short holdings', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.latestPrices.set({ '2330': 2550 });
    expect(app.portfolioExposure()).toEqual({ long: 2550000, short: 1275000, gross: 3825000, net: 1275000, ratio: 50 });
  });
  it('filters board markers without changing holdings or the chart scale', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const positions = app.tradePositions();
    const axis = app.boardAxis();
    app.changeBoardView('presets');
    expect(app.visibleBoardMarkers().length).toBe(0);
    expect(app.tradePositions()).toEqual(positions);
    expect(app.boardAxis()).toEqual(axis);
    app.changeBoardView('positions');
    expect(app.visibleBoardMarkers().length).toBeGreaterThan(0);
    expect(app.visiblePresetMarkers().length).toBe(0);
  });
  it('moves partial buy fills into holdings and removes the order only after all shares fill', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const date = app.todayDate();
    app.tradePositions.set([]);
    const order = { id: 'buy-fill', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, createdAt: date, validDays: 1, expiryDate: date };
    app.presetOrders.set([order]);
    app.startPresetFill(order);
    app.fillShares.set(400);
    app.fillPrice.set(99);
    app.confirmPresetFill();
    expect(app.tradePositions()[0].shares).toBe(400);
    expect(app.tradePositions()[0].entryPrice).toBe(99);
    expect(app.presetOrders()[0].shares).toBe(600);
    expect(app.presetFills()[0].remainingShares).toBe(600);
    expect(app.presetFills()[0].plannedPrice).toBe(100);
    expect(app.presetFills()[0].price).toBe(99);
    app.startPresetFill(app.presetOrders()[0]);
    app.confirmPresetFill();
    expect(app.presetOrders().length).toBe(0);
    expect(app.tradePositions().reduce((sum: number, p: any) => sum + p.shares, 0)).toBe(1000);
    app.confirmPresetFill();
    expect(app.tradePositions().length).toBe(2);
    expect(app.presetFills().length).toBe(2);
    app.saveWorkspace();
    expect(JSON.parse(localStorage.getItem('stock-simulator-workspace-v1')!).presetFills.length).toBe(2);
  });

  it('deducts sold shares and records realized profit without creating an extra holding', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const date = app.todayDate();
    app.tradePositions.set([{ id: 'holding', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 90, targetPrice: 110, note: '', tradeDate: date }]);
    const order = { id: 'sell-fill', action: 'sell', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, createdAt: date, validDays: 1, expiryDate: date };
    app.presetOrders.set([order]);
    app.startPresetFill(order);
    app.fillShares.set(400);
    app.confirmPresetFill();
    expect(app.tradePositions()[0].shares).toBe(600);
    expect(app.closedTrades()[0].shares).toBe(400);
    expect(app.closedTrades()[0].realizedProfit).toBeGreaterThan(0);
    expect(app.presetOrders()[0].shares).toBe(600);
  });
  it('copies a preset as a new draft without replacing the original order', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const original = { id: 'original', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 100, exitPrice: 110, validDays: 5, createdAt: '2026-10-08', note: '分批' };
    app.presetOrders.set([original]);
    app.copyPresetOrder(original);
    expect(app.editingPresetOrderId()).toBeNull();
    expect(app.positionForm().note).toBe('分批');
    app.onPositionFieldChange('entryPrice', 98);
    app.createPresetOrderFromForm();
    expect(app.presetOrders().length).toBe(2);
    expect(app.presetOrders()[0].entryPrice).toBe(100);
    expect(app.presetOrders()[1].entryPrice).toBe(98);
  });
  it('automatically saves changes after a short delay', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(App);
    try {
      const app = fixture.componentInstance as any;
      app.availableCash.set(123456);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(1100);
      expect(JSON.parse(localStorage.getItem('stock-simulator-workspace-v1')!).availableCash).toBe(123456);
      expect(app.hasUnsavedChanges()).toBe(false);
    } finally {
      fixture.destroy();
      vi.useRealTimers();
    }
  });

  it('keeps unsaved state and shows a retry message when storage fails', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.availableCash.set(123456);
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    try {
      app.saveWorkspace();
      expect(app.saveError()).toContain('儲存失敗');
      expect(app.hasUnsavedChanges()).toBe(true);
    } finally {
      storageWrite.mockRestore();
    }
    app.saveWorkspace();
    expect(app.saveError()).toBe('');
    expect(app.hasUnsavedChanges()).toBe(false);
  });
  it('rejects malformed stock codes without changing the selected stock', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.recordSymbolInput.set('23a30');
    app.addStockRecord();
    expect(app.stockSymbol()).toBe('2330');
    expect(app.recordSymbolInput()).toBe('23a30');
    expect(app.recordQuoteError()).toContain('4～6');
  });

  it('clears old indicator data immediately when a new quote is pending', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const response = new Subject();
    (TestBed.inject(StockPriceService) as any).getLatestQuote = () => response;
    app.loadCurrentPrice();
    expect(app.history()).toEqual([]);
    expect(app.indicatorStartDate()).toBe('');
    expect(app.isLoadingQuote()).toBe(true);
  });
  function setupLive() {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T04:00:00Z'));
    const app = TestBed.createComponent(App).componentInstance as any;
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const date = `${Number(today.slice(0, 4)) - 1911}/${today.slice(5, 7)}/${today.slice(8, 10)}`;
    app.requestedDate.set(today);
    app.indicatorHistory.set([{ date: '100/01/01', close: 100, high: 102, low: 98, volume: 100 }]);
    const service = TestBed.inject(StockPriceService) as any;
    const quote = { date: today.replaceAll('-', ''), close: 102, open: 100, high: 102, low: 98, volume: 200, change: 2, turnover: 0 };
    return { app, service, quote, date };
  }

  it('replaces cumulative intraday volume on repeated updates', () => {
    const { app, service, quote, date } = setupLive();
    service.getIntradayQuote = () => of(quote);
    app.toggleLive();
    app.refreshIntraday();
    expect(app.indicatorHistory().length).toBe(2);
    expect(app.history().at(-1).date).toBe(date);
    expect(app.indicatorCharts()[0].latest).toBe(200);
    service.getIntradayQuote = () => of({ ...quote, volume: 250 });
    app.refreshIntraday();
    expect(app.indicatorCharts()[0].latest).toBe(250);
  });

  it('ignores a pending live quote after the selected stock changes', () => {
    const { app, service, quote } = setupLive();
    const response = new Subject();
    service.getIntradayQuote = () => response;
    app.toggleLive();
    app.stockSymbol.set('6182');
    response.next(quote);
    expect(app.indicatorHistory().length).toBe(1);
  });

  it('does not request live quotes while viewing a historical date', () => {
    const { app, service } = setupLive();
    let requests = 0;
    service.getIntradayQuote = () => { requests++; return of(null); };
    app.requestedDate.set('2000-01-01');
    app.toggleLive();
    expect(requests).toBe(0);
    expect(app.liveStatus()).toContain('歷史日期');
  });
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: StockPriceService,
          useValue: {
            getLatestQuote: () =>
              of({
                date: '2026/08/01',
                name: '台積電',
                open: 640,
                high: 685,
                low: 610,
                close: 650,
                change: 2.5,
                turnover: 650000,
                volume: 1000,
              }),
            getHistory: () =>
              of([
                {
                  date: '2026/07/29',
                  name: '台積電',
                  open: 620,
                  high: 640,
                  low: 610,
                  close: 628,
                  change: -1.2,
                  turnover: 620000,
                  volume: 900,
                },
                {
                  date: '2026/07/30',
                  name: '台積電',
                  open: 628,
                  high: 650,
                  low: 620,
                  close: 620,
                  change: -1.9,
                  turnover: 640000,
                  volume: 1000,
                },
              ]),
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Stock Trading Simulator');
  });

  it('should render grouped position profit details', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#position-detail-title')?.textContent).toContain('持倉筆記與未實現損益');
    expect(compiled.querySelectorAll('.position-group').length).toBe(1);
    expect(compiled.querySelectorAll('.position-profit-table tbody .position-actions-row').length).toBe(2);
  });

  it('should delete all holding records for one stock after confirmation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    app.tradePositions.set([
      { id: 'a', symbol: '2330', type: '現股多單', shares: 1000, entryPrice: 600, targetPrice: 700, note: '' },
      { id: 'b', symbol: '2330', type: '融資', shares: 1000, entryPrice: 610, targetPrice: 700, note: '' },
      { id: 'c', symbol: '2317', type: '現股多單', shares: 1000, entryPrice: 180, targetPrice: 200, note: '' },
    ]);

    app.deletePositionGroup('2330');

    expect(app.tradePositions().map((position: any) => position.id)).toEqual(['c']);
  });

  it('should create a near-term preset order from the unified order board', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    (compiled.querySelector('.order-mode-switch button:nth-child(2)') as HTMLButtonElement).click();
    fixture.detectChanges();
    const button = compiled.querySelector('.form-submit') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.preset-order-row')?.textContent).toContain('預設買入');
    expect(compiled.querySelectorAll('.preset-marker').length).toBe(1);
  });

  it('should create a sell preset from an existing holding without opening a short', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    app.orderEntryMode.set('preset');
    app.onPresetOrderActionChange('sell');
    app.positionForm.update((form: any) => ({ ...form, targetPrice: 0, stopLossPrice: undefined }));
    app.createPresetOrderFromForm();
    fixture.detectChanges();

    const order = app.presetOrders().at(-1);
    expect(order.action).toBe('sell');
    expect(order.type).toBe('現股多單');
    expect(order.exitPrice).toBeUndefined();
    expect(order.stopLossPrice).toBeUndefined();
    expect((fixture.nativeElement as HTMLElement).querySelector('.preset-order-row')?.textContent).toContain('未設定出場價');
  });

  it('should edit an existing preset order without creating a duplicate', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    const order = {
      id:'edit-preset', symbol:'2330', type:'現股多單', action:'buy', shares:1000,
      entryPrice:620, exitPrice:680, validDays:5, createdAt:'2026-08-01', expiryDate:'2026-08-07', shareUnit:'boardLot',
    };
    app.presetOrders.set([order]);

    app.editPresetOrder(order);
    app.positionForm.update((form: any) => ({ ...form, entryPrice:630 }));
    app.createPresetOrderFromForm();

    expect(app.presetOrders().length).toBe(1);
    expect(app.presetOrders()[0].id).toBe('edit-preset');
    expect(app.presetOrders()[0].entryPrice).toBe(630);
  });

  it('should delete the selected board record only after confirmation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    const originalCount = app.tradePositions().length;
    const id = app.tradePositions()[0].id;

    app.selectBoardRecord(id, 'position', 100, 100);
    app.confirmSelectedBoardRecordDelete();
    expect(app.tradePositions().length).toBe(originalCount);
    app.requestSelectedBoardRecordDelete();
    app.confirmSelectedBoardRecordDelete();

    expect(app.tradePositions().length).toBe(originalCount - 1);
    expect(app.tradePositions().some((position: any) => position.id === id)).toBe(false);
  });
  it('should prevent sell preset orders when the selected stock has no sellable holding', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    app.stockSymbol.set('6182');
    app.positionForm.update((form: any) => ({ ...form, symbol:'6182' }));
    app.presetOrderAction.set('buy');
    app.onPresetOrderActionChange('sell');
    app.createPresetOrderFromForm();

    expect(app.presetOrderAction()).toBe('buy');
    expect(app.presetOrders().some((order: any) => order.symbol === '6182' && order.action === 'sell')).toBe(false);
  });
  it('should validate a sell preset against the symbol entered in the form', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    app.orderEntryMode.set('preset');
    app.positionForm.update((form: any) => ({ ...form, symbol: '6182' }));

    app.onPresetOrderActionChange('sell');

    expect(app.presetOrderAction()).toBe('buy');
    expect(app.canCreateSellPreset()).toBe(false);
  });
  it('should value existing positions with the latest quote instead of the simulated entry price', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const firstSummary = compiled.querySelector('.position-group-header');
    // Latest mocked quote is 650; the selected simulation price can change independently.
    expect(firstSummary?.textContent).toContain('-904,502');
  });

  it('should separate existing holdings while keeping price on the y-axis', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const svgText = compiled.querySelector('.board-svg')?.textContent;
    const markers = compiled.querySelectorAll('.board-svg circle');
    expect(svgText).toContain('價格');
    expect(svgText).toContain('時間');
    expect(markers[0].getAttribute('cx')).not.toBe(markers[1].getAttribute('cx'));
    expect(markers[0].getAttribute('cy')).not.toBe(markers[1].getAttribute('cy'));
  });

  it('should save the selected entry date when adding a position', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const dateInput = compiled.querySelector('.board-form input[type="date"]') as HTMLInputElement;
    dateInput.value = '2026-06-15';
    dateInput.dispatchEvent(new Event('change'));
    const addButton = Array.from(compiled.querySelectorAll('button')).find((button) => button.textContent?.includes('新增已入倉股票')) as HTMLButtonElement;
    addButton.click();
    fixture.detectChanges();
    expect((fixture.componentInstance as any).tradePositions().at(-1).tradeDate).toBe('2026-06-15');
  });

  it('should collapse and expand panels independently', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const board = compiled.querySelector('.board-panel') as HTMLElement;
    const collapseButton = board.querySelector('.collapse-button') as HTMLButtonElement;
    collapseButton.click();
    fixture.detectChanges();
    expect(board.classList.contains('collapsed')).toBe(true);
    expect(collapseButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('should render vertical candle wicks and chart axes without diagonal artifacts', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const candleWick = compiled.querySelector('.stock-chart line[stroke-width="2"]');
    expect(candleWick?.getAttribute('x1')).toBe(candleWick?.getAttribute('x2'));
    expect(compiled.querySelectorAll('.stock-chart .chart-grid-line').length).toBe(5);
    expect(compiled.querySelectorAll('.stock-chart .chart-date-label').length).toBeGreaterThanOrEqual(2);
  });

  it('should use Taiwan market colors: red for rising and green for falling candles', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const fills = Array.from(fixture.nativeElement.querySelectorAll('.stock-chart rect')).map((bar: any) => bar.getAttribute('fill'));
    expect(fills).toContain('#ff6268');
    expect(fills).toContain('#38d996');
  });

  it('should use square candle bodies and switch fields by order mode', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.stock-chart rect')?.hasAttribute('rx')).toBe(false);
    expect(compiled.querySelector('.board-form')?.textContent).not.toContain('預計出場價（選填）');
    const presetMode = Array.from(compiled.querySelectorAll('.order-mode-switch button')).find((button) => button.textContent?.includes('規劃預設單')) as HTMLButtonElement;
    presetMode.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.board-form')?.textContent).toContain('預計出場價（選填）');
    expect(compiled.querySelector('.board-form')?.textContent).not.toContain('入倉日期');
  });

  it('should render long positions in red and short positions in green on the order board', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const fills = Array.from(fixture.nativeElement.querySelectorAll('.board-svg circle')).map((marker: any) => marker.getAttribute('fill'));
    expect(fills).toContain('#ff6268');
    expect(fills).toContain('#38d996');
  });

  it('should let users add and switch between multiple stock records', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector('.stock-record-add input') as HTMLInputElement;
    input.value = '2317';
    input.dispatchEvent(new Event('input'));
    (compiled.querySelector('.stock-record-add button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.stock-record-card').length).toBe(2);
    expect(compiled.querySelector('.stock-record-card.active')?.textContent).toContain('2317');
    expect((compiled.querySelector('.board-form input[type="text"]') as HTMLInputElement).value).toBe('2317');
  });

  it('should confirm and delete a stock record while preserving investment data', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    const event = { stopPropagation: vi.fn() } as any;
    app.stockRecords.set([
      { symbol:'2330',name:'台積電',latestPrice:650,change:1,quoteDate:'115/07/31' },
      { symbol:'6182',name:'合晶',latestPrice:89,change:4.3,quoteDate:'115/07/31' },
    ]);
    app.latestPrices.set({ '2330':650, '6182':89 });
    app.stockSymbol.set('2330');
    app.tradePositions.set([{ id:'holding',symbol:'2330',type:'現股多單',shares:1000,entryPrice:600,targetPrice:0,note:'' }]);
    app.presetOrders.set([{ id:'preset',symbol:'2330',type:'現股多單',action:'buy',shares:1000,entryPrice:620,validDays:5,createdAt:'2026-08-01' }]);

    app.requestRemoveStockRecord('2330', event);
    expect(app.pendingStockRecordDelete()).toBe('2330');
    app.removeStockRecord('2330', event);

    expect(app.stockRecords().map((record: any) => record.symbol)).toEqual(['6182']);
    expect(app.latestPrices()['2330']).toBeUndefined();
    expect(app.stockSymbol()).toBe('6182');
    expect(app.tradePositions().length).toBe(1);
    expect(app.presetOrders().length).toBe(1);
  });
  it('should show every holding summary while valuing each stock with its latest price', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    app.latestPrices.set({ '2330': 650, '2317': 120 });
    app.tradePositions.set([{ id:'other',symbol:'2317',type:'現股多單',shares:10,entryPrice:100,targetPrice:100,note:'' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.position-group-header')?.textContent).toContain('195');
  });

  it('should calculate seven next-day stress scenarios for the selected stock', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    expect(app.stressScenarios().length).toBe(7);
    expect(app.stressScenarios()[0].id).toBe('range-2');
    app.presetOrders.set([{
      id:'stress-order', symbol:'2330', type:'現股多單', shares:1000,
      entryPrice:650, exitPrice:700, stopLossPrice:620, validDays:5,
      createdAt:new Date().toISOString(),
    }]);
    const scenario = app.stressScenarios().find((item: any) => item.id === 'up-5');
    expect(scenario.scenarioPrice).toBeCloseTo(682.5);
    expect(scenario.presetProfit).not.toBe(0);
    const gradualLimit = app.stressScenarios().find((item: any) => item.id === 'up-10');
    const gapLimit = app.stressScenarios().find((item: any) => item.id === 'gap-up');
    expect(gradualLimit.presetProfit).not.toBe(gapLimit.presetProfit);
  });

  it('should replace holding valuation with realized profit when a sell preset is triggered', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    const position = {
      id:'sell-stress-holding', symbol:'2330', type:'現股多單', shares:1000,
      entryPrice:600, targetPrice:600, note:'', tradeDate:'2026-07-31',
    };
    const sellOrder = {
      id:'sell-stress-order', symbol:'2330', type:'現股多單', action:'sell', shares:1000,
      entryPrice:660, validDays:5, createdAt:new Date().toISOString(),
    };
    app.tradePositions.set([position]);
    app.presetOrders.set([sellOrder]);

    const scenario = app.stressScenarios().find((item: any) => item.id === 'up-5');
    const expectedRealizedProfit = app.portfolioCalculator.simulateOrder(
      600, 660, '現股多單', 1000, app.calendarDaysBetween(position.tradeDate, app.todayInputValue()),
      app.financingRate(), app.shortBorrowRate(), app.feeDiscount(),
    );
    expect(scenario.totalProfit).toBeCloseTo(expectedRealizedProfit);
    expect(scenario.stressedExposure).toBe(0);
  });

  it('should not allocate the same holding shares to multiple sell presets', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    app.tradePositions.set([{
      id:'shared-holding', symbol:'2330', type:'現股多單', shares:1000,
      entryPrice:600, targetPrice:600, note:'', tradeDate:'2026-07-31',
    }]);
    app.presetOrders.set([
      { id:'sell-a', symbol:'2330', type:'現股多單', action:'sell', shares:700, entryPrice:660, validDays:5, createdAt:new Date().toISOString() },
      { id:'sell-b', symbol:'2330', type:'現股多單', action:'sell', shares:700, entryPrice:670, validDays:5, createdAt:new Date().toISOString() },
    ]);

    const scenario = app.stressScenarios().find((item: any) => item.id === 'up-10');
    expect(scenario.stressedExposure).toBe(0);
    expect(scenario.presetProfit).toBeGreaterThan(-scenario.holdingProfit);
  });

  it('should not treat a holding placeholder target equal to entry as a take-profit order', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    app.tradePositions.set([{
      id:'no-target', symbol:'2330', type:'現股多單', shares:1000,
      entryPrice:650, targetPrice:650, stopLossPrice:600, note:'', tradeDate:'2026-07-31',
    }]);
    const range = app.stressScenarios().find((item: any) => item.id === 'range-2');
    const upFive = app.stressScenarios().find((item: any) => item.id === 'up-5');
    expect(range.holdingProfit).not.toBe(upFive.holdingProfit);
  });

  it('should save stock records, holdings and preset orders to local storage', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    app.stockSymbol.set('6182');
    app.saveWorkspace();
    const saved = JSON.parse(localStorage.getItem('stock-simulator-workspace-v1')!);
    expect(saved.stockSymbol).toBe('6182');
    expect(saved.tradePositions.length).toBe(2);
    expect(saved.version).toBe(1);
  });

  it('preserves a valid sub-dollar execution price and blocks future holding dates', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.changeOrderMode('holding');
    app.positionForm.update((form: any) => ({ ...form, entryPrice: 0.5, shares: 1000, stopLossPrice: undefined, targetPrice: 0, tradeDate: app.todayDate() }));
    app.addTradePosition();
    expect(app.tradePositions().at(-1).entryPrice).toBe(0.5);
    const count = app.tradePositions().length;
    app.positionForm.update((form: any) => ({ ...form, tradeDate: '2999-01-01' }));
    expect(app.orderFieldError('tradeDate')).toContain('不能晚於今天');
    app.addTradePosition();
    expect(app.tradePositions().length).toBe(count);
  });

  it('prefills sale planning from the selected stock quote and keeps mixed-lot quantities explicit', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    const position = { ...app.tradePositions()[0], shares: 1500 };
    app.latestPrices.set({ [position.symbol]: 123 });
    app.positionForm.update((form: any) => ({ ...form, entryPrice: 999, stopLossPrice: 900, targetPrice: 1100 }));
    app.planPositionSale(position);
    expect(app.positionForm().entryPrice).toBe(123);
    expect(app.positionForm().shares).toBe(1500);
    expect(app.positionForm().stopLossPrice).toBeUndefined();
    expect(app.positionForm().targetPrice).toBe(0);
    expect(app.orderFieldError('shares')).toContain('1000');
    app.latestPrices.set({}); app.latestPrice.set(0);
    app.planPositionSale(position);
    expect(app.positionForm().entryPrice).toBe(0);
    expect(app.orderFieldError('entryPrice')).toContain('大於 0');
  });
});
