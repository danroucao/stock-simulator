import { DecimalPipe } from '@angular/common';
import { calculateVolumeIndicators } from './services/volume-indicators';
import { AlertCenter } from './components/alert-center/alert-center';
import { AlertDetail } from './components/alert-center/alert-detail';
import { AlertSelection } from './services/alert-store';
import { PresetFill } from './models/trade-position.model';
import { validateWorkspaceBackup } from './services/workspace-backup';
import { planningReference } from './services/planning-reference';
import { compareDailyReturns } from './services/return-analysis';
import { forkJoin } from 'rxjs';
import { simulatePlannedTrade } from './services/planned-trade-simulation';
import { isTradingDate, hasTradingCalendar, latestTradingDate } from './services/trading-calendar';
import { Component, computed, signal, DestroyRef, inject, effect, untracked, afterNextRender, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';

import { PositionDetails } from './components/position-details/position-details';
import { BacktestResult, ClosedTrade, OrderType, PositionInlineChange, PresetOrder, PresetOrderAction, TradePosition, TradePositionInput } from './models/trade-position.model';
import { PortfolioCalculatorService } from './services/portfolio-calculator.service';
import { StockHistoryPoint, StockPriceService } from './stock-price.service';

interface CandleBar {
  date: string;
  x: number;
  y: number;
  width: number;
  height: number;
  highY: number;
  lowY: number;
  fill: string;
}

interface VolumeBar {
  date: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

interface ChartTooltip {
  x: number;
  y: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
}

interface BoardMarker {
  id: string;
  x: number;
  y: number;
  label: string;
  fill: string;
  position: TradePosition;
  dateLabel: string;
}

interface BoardTooltipState {
  x: number;
  y: number;
  position: TradePosition;
}

interface PresetMarker {
  id: string;
  x: number;
  y: number;
  label: string;
  order: PresetOrder;
  dateLabel: string;
}

interface BoardRecordSelection {
  id: string;
  kind: 'position' | 'preset';
  x: number;
  y: number;
}

interface StockRecord {
  symbol: string;
  name: string;
  latestPrice: number;
  change: number;
  quoteDate: string;
}

interface StressScenario {
  id: string;
  name: string;
  assumption: string;
  scenarioPrice: number;
  holdingProfit: number;
  presetProfit: number;
  totalProfit: number;
  stressedExposure: number;
  severity: 'normal' | 'warning' | 'critical';
  changeFromNow: number;
  details: Array<{ label: string; shares: number; entry: number; exit: number; reason: string; costs: number; contribution: number; remaining?: number }>;
}

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, PositionDetails, AlertCenter, AlertDetail],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly showingAlerts = signal(false);
  protected readonly alertSelection = signal<AlertSelection | null>(null);
  protected openAlerts(event?: Event): void {
    event?.preventDefault(); this.showingAlerts.set(true);
    afterNextRender(() => {
      const target = document.getElementById('alert-center');
      if (target) { target.tabIndex=-1; target.scrollIntoView({block:'start'}); target.focus({preventScroll:true}); }
    }, {injector:this.dialogInjector});
  }
  protected viewAlert(selection: AlertSelection): void {
    this.alertSelection.set(selection); this.showingAlerts.set(false);
    this.liveEnabled.set(false);
    this.stockSymbol.set(selection.stock.symbol); this.stockName.set(selection.stock.name);
    this.requestedDate.set(selection.stock.date); this.chartDays.set(60);
    this.editingPositionId.set(null); this.editingPresetOrderId.set(null);
    this.syncOrderFormToStock(selection.stock.symbol,0);
    this.loadCurrentPrice();
    afterNextRender(() => {
      const target = document.getElementById('alert-detail');
      if (target) { target.tabIndex=-1; target.scrollIntoView({block:'start'}); target.focus({preventScroll:true}); }
    }, {injector:this.dialogInjector});
  }
  protected simulateAlert(): void {
    const selection = this.alertSelection(); if (!selection) return;
    this.changeOrderMode('preset');
    this.orderDraftEdited = true;
    this.positionForm.update(form => ({...form,symbol:selection.stock.symbol,
      note:`提醒中心：${selection.event?.status || selection.stock.status}；事件 ${selection.event?.date || selection.stock.eventDate}；${selection.event?.id || selection.stock.range?.id || ''}`}));
    this.navigateWorkspace(new Event('click'),'strategy-board');
  }

  private readonly workspaceStorageKey = 'stock-simulator-workspace-v1';
  protected readonly title = signal('Stock Trading Simulator');
  protected readonly stockSymbol = signal('2330');
  protected readonly stockName = signal('台積電');
  protected readonly recordSymbolInput = signal('');
  protected readonly stockRecords = signal<StockRecord[]>([]);
  protected readonly latestPrices = signal<Record<string, number>>({});
  protected readonly recordQuoteLoading = signal('');
  protected readonly recordQuoteError = signal('');
  protected readonly pendingStockRecordDelete = signal<string | null>(null);
  protected readonly requestedDate = signal(this.todayInputValue());
  protected readonly effectiveMarketDate = computed(() => latestTradingDate(this.requestedDate()));
  protected readonly canUpdateIntraday = computed(() => this.requestedDate() === this.todayDate() && isTradingDate(this.todayDate()));
  protected readonly chartDays = signal(20);
  protected readonly limitUpPrice = signal(685);
  protected readonly limitDownPrice = signal(610);
  protected readonly selectedPrice = signal(650);
  protected readonly shares = signal(1000);
  protected readonly orderType = signal<OrderType>('現股多單');
  protected readonly longTermTarget = signal(760);
  protected readonly holdingDays = signal(30);
  protected readonly financingRate = signal(4.5);
  protected readonly shortBorrowRate = signal(3.2);
  protected readonly feeDiscount = signal(0.6);
  protected readonly availableCash = signal(1_000_000);
  protected readonly maxRiskPerTrade = signal(10_000);
  protected readonly maxStockWeight = signal(25);
  protected readonly quoteDate = signal('');
  protected displayDate(value: string | undefined | null): string {
    if (!value) return '無資料';
    const match = /^(\d{3,4})[-/]?(\d{2})[-/]?(\d{2})(?:T.*)?$/.exec(value);
    if (!match) return value;
    const year = Number(match[1]) + (match[1].length === 3 ? 1911 : 0);
    return `${year}/${match[2]}/${match[3]}`;
  }

  protected navigateWorkspace(event: Event, targetId: string): void {
    event.preventDefault();
    const panels = new Set(this.collapsedPanels());
    panels.delete(targetId === 'market-chart' ? 'chart' : 'board');
    if (targetId === 'risk-analysis') panels.delete('stress');
    this.collapsedPanels.set(panels);
    afterNextRender(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      if (targetId === 'workspace-settings') target.querySelector('details')?.setAttribute('open', '');
      target.tabIndex = -1;
      target.style.scrollMarginTop = `${(document.querySelector('.planning-summary')?.getBoundingClientRect().height ?? 80) + 24}px`;
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
    }, { injector: this.dialogInjector });
  }
  protected readonly quoteChange = signal(0);
  protected readonly quoteSource = signal('');
  protected readonly quoteSourceTime = signal('');
  protected readonly quoteFetchedAt = signal('');
  protected readonly priceAlerts = signal<Record<string, { lower?: number; upper?: number }>>({});
  protected readonly currentPriceAlert = computed(() => this.priceAlerts()[this.stockSymbol()] ?? {});
  protected readonly priceAlertMessage = computed(() => {
    const alert = this.currentPriceAlert(), price = this.latestPrice();
    if (!(price > 0)) return '';
    if (alert.lower !== undefined && price <= alert.lower) return `${this.stockSymbol()} 行情 ${price} 已達下限 ${alert.lower}`;
    if (alert.upper !== undefined && price >= alert.upper) return `${this.stockSymbol()} 行情 ${price} 已達上限 ${alert.upper}`;
    return '';
  });
  protected readonly priceAlertError = signal('');
  protected readonly costModel = computed(() => this.portfolioCalculator.costSettings());
  protected readonly costModelError = signal('');
  protected readonly numericSettingsError = signal('');
  protected updateNumericSetting(key: 'availableCash' | 'maxRiskPerTrade' | 'maxStockWeight' | 'feeDiscount' | 'cashOpeningBalance' | 'financingRate' | 'shortBorrowRate', raw: string): void {
    const value = Number(raw);
    const minimum = key === 'maxRiskPerTrade' || key === 'maxStockWeight' ? 1 : key === 'cashOpeningBalance' ? -Number.MAX_VALUE : 0;
    const maximum = key === 'feeDiscount' ? 1 : key === 'maxStockWeight' ? 100 : Number.MAX_VALUE;
    if (!raw.trim() || !Number.isFinite(value) || value < minimum || value > maximum) {
      this.numericSettingsError.set('輸入超出允許範圍或不是有效數字，已保留原設定。'); return;
    }
    this.numericSettingsError.set('');
    this[key].set(value);
  }
  protected updateCostModel(key: 'feeRate' | 'minimumFee' | 'taxRate' | 'financingLoanRatio', raw: string): void {
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < 0 || (key !== 'minimumFee' && value > 1)) { this.costModelError.set('請輸入有效數值；比例以小數表示，範圍 0～1。'); return; }
    this.costModelError.set('');
    this.portfolioCalculator.costSettings.update(settings => ({ ...settings, [key]: value }));
  }
  protected readonly stockIndustries = signal<Record<string, string>>({});
  protected setStockIndustry(symbol: string, industry: string): void {
    this.stockIndustries.update(values => ({ ...values, [symbol]: industry.trim().slice(0, 40) }));
  }
  protected readonly industryExposure = computed(() => {
    const groups = new Map<string, number>();
    for (const position of this.tradePositions()) {
      const label = this.stockIndustries()[position.symbol] || '未分類';
      groups.set(label, (groups.get(label) ?? 0) + this.marketPriceForSymbol(position.symbol) * position.shares);
    }
    const total = [...groups.values()].reduce((sum, value) => sum + value, 0);
    return [...groups].map(([industry, value]) => ({ industry, value, weight: total > 0 ? value / total * 100 : 0 })).sort((a, b) => b.value - a.value);
  });
  protected updatePriceAlert(key: 'lower' | 'upper', value: string): void {
    const next = { ...this.currentPriceAlert(), [key]: value.trim() ? Number(value) : undefined };
    if ((next.lower !== undefined && (!Number.isFinite(next.lower) || next.lower <= 0)) || (next.upper !== undefined && (!Number.isFinite(next.upper) || next.upper <= 0)) || (next.lower !== undefined && next.upper !== undefined && next.lower >= next.upper)) {
      this.priceAlertError.set('價格須大於 0，且下限須低於上限。未保存此變更。'); return;
    }
    this.priceAlertError.set('');
    this.priceAlerts.update(alerts => ({ ...alerts, [this.stockSymbol()]: next }));
  }
  protected readonly estimatedPriceSymbols = computed(() => [...new Set(this.tradePositions().filter(position =>
    !(this.latestPrices()[position.symbol] > 0) && !(position.symbol === this.stockSymbol() && this.latestPrice() > 0),
  ).map(position => position.symbol))]);
  protected readonly latestPrice = signal(0);
  protected readonly turnover = signal(0);
  protected readonly isLoadingQuote = signal(false);
  protected readonly quoteError = signal('');
  protected readonly history = signal<StockHistoryPoint[]>([]);
  private readonly indicatorHistory = signal<StockHistoryPoint[]>([]);
  protected readonly planningLevels = computed(() => planningReference(this.indicatorHistory()));
  private readonly destroyRef = inject(DestroyRef);
  private liveRequestId = 0;
  protected readonly liveEnabled = signal(false);
  protected readonly liveLoading = signal(false);
  protected readonly liveStatus = signal('');
  private historyRequestId = 0;
  private quoteRequestId = 0;
  protected readonly todayDate = signal(this.todayInputValue());
  protected readonly storageConflict = signal(false);
  private expectedStoredWorkspace: string | null = null;

  protected refreshCalendar(): void {
    const today = this.todayInputValue(), previous = this.todayDate();
    if (today === previous) return;
    this.todayDate.set(today);
    if (!this.editingPresetOrderId()) this.onPresetExpiryChange(this.presetExpiryDate());
    if (this.requestedDate() === previous) {
      this.requestedDate.set(today);
      this.loadCurrentPrice();
    }
  }

  protected useOtherTabWorkspace(): void {
    try {
      const raw = localStorage.getItem(this.workspaceStorageKey);
      if (!raw) throw new Error('另一分頁已清除資料，請保留目前資料或先匯出備份。');
      validateWorkspaceBackup(raw);
      this.restoreWorkspace();
      this.storageConflict.set(false);
      this.autoSaveEnabled.set(true);
      this.editingPositionId.set(null);
      this.editingPresetOrderId.set(null);
      this.fillOrderId.set(null);
      this.closingPositionId.set(null);
      this.loadCurrentPrice();
    } catch (error) { this.saveError.set(error instanceof Error ? error.message : '無法讀取另一分頁資料。'); }
  }

  protected keepThisTabWorkspace(): void {
    try {
      const other = localStorage.getItem(this.workspaceStorageKey);
      if (other) localStorage.setItem(`${this.workspaceStorageKey}-before-conflict`, other);
      this.expectedStoredWorkspace = other;
      this.storageConflict.set(false);
      this.saveWorkspace();
    } catch { this.saveError.set('無法備份衝突資料，已停止覆寫。'); }
  }
  protected readonly historyLoading = signal(false);
  protected readonly historyError = signal('');
  protected readonly chartIndicators = signal({ obv: false, adl: false, histogram: false });
  protected toggleChartIndicator(key: 'obv' | 'adl' | 'histogram'): void {
    this.chartIndicators.update(value => ({ ...value, [key]: !value[key] }));
  }
  protected readonly indicatorStartDate = computed(() => this.indicatorHistory()[0]?.date ?? '');
  private readonly volumeIndicatorSeries = computed(() => calculateVolumeIndicators(this.indicatorHistory()));
  protected readonly hoveredIndicators = computed(() => this.volumeIndicatorSeries().find(point => point.date === this.tooltip()?.date));
  protected readonly adlDailyPoints = computed(() => {
    const series = this.volumeIndicatorSeries();
    return series.map((point, index) => ({ date: point.date, value: point.adl - (series[index - 1]?.adl ?? 0) })).slice(-this.chartDays());
  });
  protected readonly hoveredAdlChange = computed(() => this.adlDailyPoints().find(point => point.date === this.tooltip()?.date)?.value);
  protected readonly adlHistogram = computed(() => {
    const points = this.adlDailyPoints();
    const scale = Math.max(...points.map(point => Math.abs(point.value)), 1);
    const interval = 724 / Math.max(points.length, 1);
    return {
      scale,
      bars: points.map((point, index) => {
        const height = Math.abs(point.value) / scale * 52;
        return {
          ...point, x: 18 + (index + 0.2) * interval, width: interval * 0.6,
          y: point.value > 0 ? 70 - height : point.value < 0 ? 70 : 69.5,
          height: point.value === 0 ? 1 : height,
          fill: point.value > 0 ? '#ff6268' : point.value < 0 ? '#38d996' : '#a9b6c9',
        };
      }),
    };
  });
  protected readonly indicatorCharts = computed(() => {
    const series = this.volumeIndicatorSeries();
    const points = series.slice(-this.chartDays());
    return (['obv', 'adl'] as const).map(key => {
      const values = points.map(point => point[key]);
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      return {
        key, label: key === 'obv' ? 'OBV 能量潮' : 'A/D 收集／派發線',
        latest: points.at(-1)?.[key] ?? null, min, max,
        change: series.length > 1 ? series.at(-1)![key] - series.at(-2)![key] : null,
        path: points.map((point, index) => {
          const x = 18 + (index + 0.5) * 724 / Math.max(points.length, 1);
          const y = max === min ? 70 : 120 - (point[key] - min) / (max - min) * 100;
          return `${index ? 'L' : 'M'} ${x} ${y}`;
        }).join(' '),
      };
    });
  });
  protected readonly tooltip = signal<ChartTooltip | null>(null);
  protected readonly adlLineChart = computed(() => this.indicatorCharts().find(chart => chart.key === 'adl')!);
  protected readonly boardTooltip = signal<BoardTooltipState | null>(null);
  protected readonly draggingBoardMarker = signal<string | null>(null);
  protected readonly editingPositionId = signal<string | null>(null);
  protected readonly editingPresetOrderId = signal<string | null>(null);
  protected readonly selectedBoardRecord = signal<BoardRecordSelection | null>(null);
  protected readonly pendingBoardRecordDelete = signal<string | null>(null);
  protected readonly orderEntryMode = signal<'holding' | 'preset' | 'reduce'>('holding');
  private orderDraftEdited = false;
  private readonly editedPlanningPrices = new Set<string>();
  protected readonly presetOrderAction = signal<PresetOrderAction>('buy');
  protected readonly shareUnit = signal<'boardLot' | 'oddLot'>('boardLot');
  protected readonly simulationShareUnit = signal<'boardLot' | 'oddLot'>('boardLot');
  protected readonly collapsedPanels = signal<Set<string>>(new Set(['future', 'backtest', 'stress']));
  protected readonly selectedStressScenario = signal<string | null>(null);
  protected readonly worstStressScenario = computed(() => [...this.stressScenarios()].sort((a, b) => a.changeFromNow - b.changeFromNow)[0] ?? null);
  protected readonly saveStatus = signal('');
  protected readonly autoSaveEnabled = signal(true);
  protected readonly saveError = signal('');
  protected readonly backupStatus = signal('');
  protected readonly importPreview = signal<{ raw: string; filename: string; positions: number; orders: number; fills: number; stocks: number } | null>(null);
  protected async readWorkspaceBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importPreview.set(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('備份檔請小於 5 MB。');
      const saved = validateWorkspaceBackup(await file.text());
      this.importPreview.set({ raw: JSON.stringify(saved), filename: file.name, positions: saved['tradePositions'].length, orders: saved['presetOrders'].length, fills: saved['presetFills'].length, stocks: saved['stockRecords'].length });
      this.backupStatus.set('檔案驗證完成，請核對筆數後確認還原。');
    } catch (error) {
      this.backupStatus.set(`匯入失敗：${error instanceof Error ? error.message : '檔案格式不正確'}。目前資料未變更。`);
    }
  }
  protected confirmWorkspaceImport(): void {
    const preview = this.importPreview();
    if (!preview) return;
    if (this.storageConflict() || localStorage.getItem(this.workspaceStorageKey) !== this.expectedStoredWorkspace) {
      this.storageConflict.set(true);
      this.autoSaveEnabled.set(false);
      this.backupStatus.set('另一分頁資料已變更，請先解決儲存衝突再匯入。'); return;
    }
    try {
      validateWorkspaceBackup(preview.raw);
      localStorage.setItem(`${this.workspaceStorageKey}-before-import`, this.workspaceBackupJson());
      localStorage.setItem(this.workspaceStorageKey, preview.raw);
    } catch {
      this.backupStatus.set('無法保留還原前備份或寫入資料，已停止還原，目前資料未變更。'); return;
    }
    this.restoreWorkspace();
    this.importPreview.set(null);
    this.closingPositionId.set(null);
    this.fillOrderId.set(null);
    this.editingPositionId.set(null);
    this.editingPresetOrderId.set(null);
    this.backupStatus.set('已還原備份；還原前資料已保留在目前瀏覽器。');
    this.loadCurrentPrice();
  }
  protected previewBeforeImportBackup(): void {
    try {
      const raw = localStorage.getItem(`${this.workspaceStorageKey}-before-import`);
      if (!raw) { this.backupStatus.set('目前瀏覽器尚無還原前備份。'); return; }
      const saved = validateWorkspaceBackup(raw);
      this.importPreview.set({ raw: JSON.stringify(saved), filename: '還原前自動備份', positions: saved['tradePositions'].length, orders: saved['presetOrders'].length, fills: saved['presetFills'].length, stocks: saved['stockRecords'].length });
    } catch { this.backupStatus.set('無法讀取還原前備份，目前資料未變更。'); }
  }
  protected readonly exportingExcel = signal(false);
  protected readonly orderStatus = signal('');
  protected readonly pendingPresetCancel = signal<string | null>(null);
  protected readonly boardView = signal<'all' | 'positions' | 'presets'>('all');
  protected readonly visibleBoardMarkers = computed(() => this.boardView() === 'presets' ? [] : this.boardMarkers());
  protected readonly visiblePresetMarkers = computed(() => this.boardView() === 'positions' ? [] : this.presetMarkers());
  protected changeBoardView(view: 'all' | 'positions' | 'presets'): void {
    this.boardView.set(view);
    this.boardTooltip.set(null);
    this.selectedBoardRecord.set(null);
    this.pendingBoardRecordDelete.set(null);
    this.draggingBoardMarker.set(null);
  }
  protected readonly fillOrderId = signal<string | null>(null);
  protected readonly fillPrice = signal(0);
  protected readonly fillShares = signal(0);
  protected readonly fillDate = signal(this.todayInputValue());
  protected readonly fillMessage = signal('');
  protected readonly cashTrackingEnabled = signal(false);
  protected readonly cashOpeningBalance = signal(0);
  protected readonly cashMovements = signal<Array<{ id: string; date: string; kind: string; amount: number; note: string }>>([]);
  protected readonly trackedCashBalance = computed(() => this.cashOpeningBalance() + this.cashMovements().reduce((sum, movement) => sum + movement.amount, 0));
  protected readonly cashMovementAmount = signal(0);
  protected readonly cashMovementKind = signal<'deposit' | 'withdrawal'>('deposit');
  protected readonly cashMovementNote = signal('');
  protected readonly cashLedgerStatus = signal('');
  protected addManualCashMovement(): void {
    const amount = this.cashMovementAmount();
    if (!Number.isFinite(amount) || amount <= 0) { this.cashLedgerStatus.set('請輸入大於 0 的金額。'); return; }
    this.cashMovements.update(items => [...items, { id: crypto.randomUUID(), date: this.todayInputValue(), kind: this.cashMovementKind() === 'deposit' ? '存入' : '支出', amount: this.cashMovementKind() === 'deposit' ? amount : -amount, note: this.cashMovementNote().trim() }]);
    this.cashMovementAmount.set(0);
    this.cashMovementNote.set('');
    this.cashLedgerStatus.set('已新增手動流水；規劃資金不會自動改變。');
  }
  protected applyTrackedCash(): void {
    if (this.trackedCashBalance() >= 0) { this.availableCash.set(this.trackedCashBalance()); this.cashLedgerStatus.set('已將流水餘額帶入規劃資金。'); }
  }
  private recordCashTrade(id: string, date: string, price: number, shares: number, sell: boolean, type: OrderType): void {
    if (!this.cashTrackingEnabled()) return;
    if (type !== '現股多單') { this.cashLedgerStatus.set('此筆非現股交易，未自動寫入資金流水；保證金或融資交割需自行核對。'); return; }
    const costs = this.portfolioCalculator.tradeCosts(price, price, type, shares, 1, 0, 0, this.feeDiscount());
    const amount = sell ? price * shares - costs.sellFee - costs.transactionTax : -price * shares - costs.buyFee;
    this.cashMovements.update(items => [...items, { id, date, kind: sell ? '現股賣出' : '現股買進', amount, note: `${shares} 股 × ${price} 元；模型費稅估算` }]);
  }
  private tradeStateJson(): string {
    return JSON.stringify({ positions: this.tradePositions(), orders: this.presetOrders(), closed: this.closedTrades(), fills: this.presetFills(), archived: this.archivedPresetOrders(), cash: this.cashMovements() });
  }
  protected readonly lastTradeUndo = signal<{ before: string; after: string; description: string } | null>(null);
  protected readonly confirmUndoTrade = signal(false);
  protected readonly undoTradeStatus = signal('');
  protected readonly canUndoTrade = computed(() => {
    const undo = this.lastTradeUndo();
    return !!undo && this.tradeStateJson() === undo.after;
  });
  protected undoLastTradeRecord(): void {
    const undo = this.lastTradeUndo();
    if (!undo || !this.confirmUndoTrade()) return;
    if (!this.canUndoTrade()) { this.undoTradeStatus.set('後續交易資料已改變，無法安全撤回。請保留備份後核對紀錄。'); return; }
    const prior = JSON.parse(undo.before);
    this.tradePositions.set(prior.positions);
    this.presetOrders.set(prior.orders);
    this.closedTrades.set(prior.closed);
    this.presetFills.set(prior.fills);
    this.archivedPresetOrders.set(prior.archived);
    this.cashMovements.set(prior.cash ?? []);
    this.lastTradeUndo.set(null);
    this.confirmUndoTrade.set(false);
    this.fillOrderId.set(null);
    this.closingPositionId.set(null);
    this.fillMessage.set('');
    this.closingStatus.set('');
    this.undoTradeStatus.set('已撤回網站最近一次成交記錄；持倉、委託與損益已還原，券商實際成交不受影響。');
  }
  protected readonly closingPositionId = signal<string | null>(null);
  protected readonly closingPrice = signal(0);
  protected readonly closingShares = signal(0);
  protected readonly closingDate = signal(this.todayInputValue());
  protected readonly closingStatus = signal('');
  protected readonly closingPosition = computed(() => this.tradePositions().find(position => position.id === this.closingPositionId()));
  protected readonly closingIsShort = computed(() => this.closingPosition()?.type === '空單' || this.closingPosition()?.type === '融券');
  protected readonly closingError = computed(() => {
    const position = this.closingPosition();
    if (!position) return '原持倉已不存在。';
    if (!Number.isFinite(this.closingPrice()) || this.closingPrice() <= 0) return '成交價須大於 0。';
    if (!Number.isInteger(this.closingShares()) || this.closingShares() <= 0 || this.closingShares() > position.shares) return '成交股數須介於 1 與剩餘持倉股數之間。';
    const date = this.closingDate();
    const parsed = new Date(`${date}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || this.toInputDate(parsed) !== date || date > this.todayInputValue() || (position.tradeDate && date < position.tradeDate)) return '成交日期須在入倉日與今天之間。';
    return '';
  });
  protected closingFieldError(field: 'price' | 'shares' | 'date'): string {
    const error = this.closingError();
    const matches = field === 'price' ? error.includes('成交價') : field === 'shares' ? error.includes('股數') : error.includes('日期');
    return matches ? error : '';
  }
  protected readonly closingPreview = computed(() => {
    const position = this.closingPosition();
    if (!position || this.closingError()) return null;
    const days = this.calendarDaysBetween(position.tradeDate, this.closingDate());
    const costs = this.portfolioCalculator.positionExitCosts(position, this.closingPrice(), this.closingShares(), days,
      this.financingRate(), this.shortBorrowRate(), this.feeDiscount());
    const gross = (this.closingIsShort() ? position.entryPrice - this.closingPrice() : this.closingPrice() - position.entryPrice) * this.closingShares();
    return { costs, gross, net: gross - costs.total, remaining: position.shares - this.closingShares() };
  });
  protected readonly presetFills = signal<PresetFill[]>([]);
  protected readonly archivedPresetOrders = signal<Array<PresetOrder & { finalStatus: '已成交' | '取消'; finalizedAt: string }>>([]);
  protected readonly orderHistory = computed(() => [
    ...this.presetOrders().map(order => ({ ...order, status: this.isPresetExpired(order) ? '過期' : this.presetFills().some(fill => fill.orderId === order.id) ? '部分成交' : '待成交' })),
    ...this.archivedPresetOrders().map(order => ({ ...order, status: order.finalStatus })),
  ].filter(order => this.fillHistoryScope() === 'all' || order.symbol === this.stockSymbol()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  protected readonly hasSamplePositions = computed(() => this.tradePositions().some(position => position.id === 'sample-long' || position.id === 'sample-short'));
  protected readonly confirmRemoveSamples = signal(false);
  protected removeSamplePositions(): void {
    if (!this.confirmRemoveSamples()) return;
    this.tradePositions.update(items => items.filter(position => position.id !== 'sample-long' && position.id !== 'sample-short'));
    this.confirmRemoveSamples.set(false);
  }
  protected readonly fillHistoryScope = signal<'current' | 'all'>('current');
  protected readonly visiblePresetFills = computed(() => [...this.presetFills()]
    .filter(fill => this.fillHistoryScope() === 'all' || fill.symbol === this.stockSymbol())
    .sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt)));

  protected isPresetExpired(order: PresetOrder): boolean {
    return !!order.expiryDate && order.expiryDate < this.todayDate();
  }

  protected startPresetFill(order: PresetOrder): void {
    this.fillOrderId.set(order.id);
    this.fillPrice.set(order.entryPrice);
    this.fillShares.set(order.shares);
    this.fillDate.set(this.isPresetExpired(order) ? order.expiryDate! : this.todayInputValue());
    this.fillMessage.set('');
  }

  protected confirmPresetFill(): void {
    const order = this.presetOrders().find(item => item.id === this.fillOrderId());
    if (!order) return;
    const price = this.fillPrice(), shares = this.fillShares(), date = this.fillDate();
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(shares) || shares <= 0 || shares > order.shares) {
      this.fillMessage.set('請輸入有效成交價與股數；成交股數不可超過剩餘委託股數。'); return;
    }
    const createdDate = order.createdAt.includes('T') ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date(order.createdAt)) : order.createdAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < createdDate || date > this.todayInputValue() || (order.expiryDate && date > order.expiryDate)) {
      this.fillMessage.set('成交日期須在建立日與有效期限之間，且不可晚於今天。'); return;
    }
    const id = `fill-${crypto.randomUUID()}`;
    const undoBefore = this.tradeStateJson();
    if (order.action === 'sell') {
      const positions = this.tradePositions().filter(position => position.symbol === order.symbol && position.type === order.type && (!position.tradeDate || position.tradeDate <= date))
        .sort((a, b) => (a.tradeDate ?? '').localeCompare(b.tradeDate ?? ''));
      if (positions.reduce((sum, position) => sum + position.shares, 0) < shares) {
        this.fillMessage.set('符合股票、交易類型與成交日期的持倉不足。'); return;
      }
      let remaining = shares;
      const sold = new Map<string, number>();
      const closed: ClosedTrade[] = [];
      for (const position of positions) {
        const quantity = Math.min(position.shares, remaining);
        if (!quantity) break;
        sold.set(position.id, quantity);
        closed.push({ ...position, id: `${id}-${position.id}`, shares: quantity, exitPrice: price, exitDate: date,
          ...this.tradeCostSnapshot(position.entryPrice, price, position.type, quantity, this.calendarDaysBetween(position.tradeDate, date), position),
          realizedProfit: (position.type === '空單' || position.type === '融券' ? position.entryPrice - price : price - position.entryPrice) * quantity - this.portfolioCalculator.positionExitCosts(position, price, quantity,
            this.calendarDaysBetween(position.tradeDate, date), this.financingRate(), this.shortBorrowRate(), this.feeDiscount()).total });
        remaining -= quantity;
      }
      this.tradePositions.update(items => items.map(position => this.reducePositionShares(position, sold.get(position.id) ?? 0)).filter(position => position.shares > 0));
      this.closedTrades.update(items => [...items, ...closed]);
    } else {
      const entryCosts = this.portfolioCalculator.tradeCosts(price, price, order.type, shares, 1, 0, 0, this.feeDiscount());
      const short = order.type === '空單' || order.type === '融券';
      this.tradePositions.update(items => [...items, { id, symbol: order.symbol, type: order.type, shares,
        entryFeePaid: short ? entryCosts.sellFee : entryCosts.buyFee, entryTaxPaid: short ? entryCosts.transactionTax : 0,
        entryPrice: price, targetPrice: order.exitPrice ?? price, stopLossPrice: order.stopLossPrice,
        tradeDate: date, note: `${order.note ?? ''} 待成交委託成交：${order.id}`.trim() }]);
    }
    this.presetOrders.update(items => items.flatMap(item => item.id !== order.id ? [item] : item.shares > shares ? [{ ...item, shares: item.shares - shares }] : []));
    if (shares === order.shares) this.archivedPresetOrders.update(items => [...items, { ...order, shares: 0, finalStatus: '已成交', finalizedAt: new Date().toISOString() }]);
    this.presetFills.update(items => [...items, { id, orderId: order.id, symbol: order.symbol, type: order.type,
      action: order.action ?? 'buy', date, price, shares, plannedPrice: order.entryPrice,
      remainingShares: order.shares - shares, recordedAt: new Date().toISOString(), note: order.note ?? '' }]);
    this.recordCashTrade(id, date, price, shares, order.action === 'sell', order.type);
    this.lastTradeUndo.set({ before: undoBefore, after: this.tradeStateJson(), description: `${order.symbol} 待成交委託成交 ${shares} 股` });
    this.confirmUndoTrade.set(false);
    this.undoTradeStatus.set('');
    if (this.editingPresetOrderId() === order.id) this.editingPresetOrderId.set(null);
    this.fillOrderId.set(null);
    this.fillMessage.set(`已記錄 ${order.symbol} 成交 ${shares} 股，${order.action === 'sell' ? '已更新持倉與已實現損益' : '已轉入持倉'}；剩餘 ${order.shares - shares} 股。`);
  }

  protected copyPresetOrder(order: PresetOrder): void {
    this.editPresetOrder(order);
    this.editingPresetOrderId.set(null);
    this.orderStatus.set(`已帶入 ${order.symbol} 的待成交委託。請調整委託價後建立新單，原單會保留。`);
  }
  protected readonly orderFormError = computed(() => {
    const form = this.positionForm();
    if (!/^\d{4,6}$/.test(form.symbol.trim())) return '請輸入 4～6 位數字的股票代號。';
    if (!Number.isFinite(form.entryPrice) || form.entryPrice <= 0) return '請輸入大於 0 的委託價格。';
    if (this.orderEntryMode() === 'holding' && form.tradeDate) {
      const date = new Date(`${form.tradeDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.tradeDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== form.tradeDate || form.tradeDate > this.todayInputValue()) return '入倉日期須為有效日期，且不能晚於今天。';
    }
    if (!Number.isInteger(form.shares) || form.shares <= 0) return '股數必須是大於 0 的整數。';
    if (this.shareUnit() === 'boardLot' && form.shares % 1000 !== 0) return '整張股數須為 1000 的倍數，或切換成零股。';
    if (this.shareUnit() === 'oddLot' && form.shares > 999) return '零股請輸入 1～999 股。';
    if (this.orderEntryMode() !== 'preset' || this.presetOrderAction() !== 'sell') {
      if (form.stopLossPrice !== undefined && (!Number.isFinite(form.stopLossPrice) || form.stopLossPrice <= 0)) return '停損價須大於 0，或留空。';
      if (!Number.isFinite(form.targetPrice) || form.targetPrice < 0) return '預計出場價須大於 0，或留空。';
    }
    if (this.orderEntryMode() === 'preset' && this.presetOrderAction() === 'sell') {
      if (!this.canCreateSellPreset()) return '此股票沒有可供賣出的持倉。';
      if (form.type !== '現股多單' && form.type !== '融資') return '賣出持倉請選擇現股多單或融資；空單請使用持倉回補流程。';
      if (form.shares > this.availableSellOrderShares()) return '合計賣出委託超過此交易類型的持倉，請調整股數或取消其他賣出單。';
    }
    return '';
  });

  protected orderFieldError(field: 'symbol' | 'entryPrice' | 'shares' | 'stopLossPrice' | 'targetPrice' | 'tradeDate'): string {
    const error = this.orderFormError();
    const matches = field === 'symbol' ? error.includes('股票代號') : field === 'entryPrice' ? error.includes('委託價格') : field === 'shares' ? /股數|零股|合計賣出/.test(error) : field === 'stopLossPrice' ? error.includes('停損價') : field === 'tradeDate' ? error.includes('入倉日期') : error.includes('預計出場價');
    return matches ? error : '';
  }

  protected changeOrderMode(mode: 'holding' | 'preset' | 'reduce'): void {
    this.orderEntryMode.set(mode);
    if (mode === 'preset') this.presetOrderAction.set('buy');
    this.editingPositionId.set(null);
    this.editingPresetOrderId.set(null);
    this.orderStatus.set('');
  }

  protected planPositionSale(position: TradePosition): void {
    if (position.type !== '現股多單' && position.type !== '融資') return;
    this.changeOrderMode('preset');
    this.presetOrderAction.set('sell');
    this.orderDraftEdited = true;
    const price = this.latestPrices()[position.symbol] ?? (position.symbol === this.stockSymbol() ? this.latestPrice() : 0);
    this.positionForm.update(form => ({ ...form, symbol: position.symbol, type: position.type, shares: position.shares,
      entryPrice: price > 0 ? price : 0, stopLossPrice: undefined, targetPrice: 0 }));
    this.shareUnit.set(position.shares <= 999 ? 'oddLot' : 'boardLot');
    this.onPresetExpiryChange(this.presetDateMax);
    this.orderStatus.set((price > 0 ? '已帶入最近取得的行情價格，請確認委託價。' : '尚無行情，請自行輸入委託價。')
      + '股數未調整，額度按同股票與類型合計；整張與零股混合請拆單。本頁不送出券商委託。');
  }

  protected cancelOrderEdit(): void {
    this.editingPositionId.set(null);
    this.editingPresetOrderId.set(null);
    this.syncOrderFormToStock(this.stockSymbol(), this.valuationPrice());
    this.orderStatus.set('已取消編輯，原記錄未變更。');
  }

  protected useCurrentMarketPrice(): void {
    const price = this.latestPrices()[this.positionForm().symbol.trim()];
    if (price > 0) this.onPositionFieldChange('entryPrice', price);
    else this.orderStatus.set('此股票尚無行情，請先在上方新增或選擇股票。');
  }
  protected readonly excelScope = signal<'all' | 'current'>('all');
  protected readonly excelIncludeExpired = signal(false);
  protected readonly excelOrders = computed(() => this.presetOrders().filter(order =>
    (this.excelScope() === 'all' || order.symbol === this.stockSymbol()) &&
    (this.excelIncludeExpired() || !order.expiryDate || order.expiryDate >= this.todayDate()),
  ));
  protected readonly excelPreview = computed(() => {
    const orders = this.excelOrders();
    return {
      count: orders.length,
      symbols: new Set(orders.map(order => order.symbol)).size,
      buyAmount: orders.filter(order => order.action !== 'sell').reduce((sum, order) => sum + order.entryPrice * order.shares, 0),
      sellAmount: orders.filter(order => order.action === 'sell').reduce((sum, order) => sum + order.entryPrice * order.shares, 0),
      unknownExpiry: orders.filter(order => !order.expiryDate).length,
    };
  });

  protected async exportPresetOrdersExcel(historyOnly = false): Promise<void> {
    const orders = this.excelOrders();
    const fills = this.visiblePresetFills();
    if (this.exportingExcel() || (historyOnly ? !fills.length : !orders.length)) return;
    const scope = (historyOnly ? this.fillHistoryScope() : this.excelScope()) === 'all' ? '全部股票' : this.stockSymbol();
    const filterDescription = `${scope}；${this.excelIncludeExpired() ? '包含過期單' : '排除已知過期單'}；判斷日期 ${this.todayDate()}`;
    this.exportingExcel.set(true);
    this.backupStatus.set('');
    try {
      const { buildPresetOrderWorkbook, buildFillHistoryWorkbook } = await import('./services/preset-order-export');
      const names = Object.fromEntries(this.stockRecords().map(record => [record.symbol, record.name]));
      const book = historyOnly ? await buildFillHistoryWorkbook(fills, names) : await buildPresetOrderWorkbook(orders, names, filterDescription);
      const data = await book.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${historyOnly ? '實際成交紀錄' : '待成交委託規劃'}-${scope}-${this.todayInputValue()}.xlsx`;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      this.backupStatus.set(historyOnly ? '已送出實際成交紀錄 Excel 下載。' : '已送出待成交委託 Excel 下載，包含明細、布局總覽及使用說明。');
    } catch {
      this.backupStatus.set('Excel 匯出失敗，請稍後重試。');
    } finally {
      this.exportingExcel.set(false);
    }
  }
  private readonly savedWorkspaceContent = signal('');
  private readonly workspaceContent = computed(() => JSON.stringify({
    stockSymbol: this.stockSymbol(), stockName: this.stockName(), stockRecords: this.stockRecords(),
    latestPrices: this.latestPrices(), tradePositions: this.tradePositions(), presetOrders: this.presetOrders(),
    closedTrades: this.closedTrades(), presetFills: this.presetFills(), archivedPresetOrders: this.archivedPresetOrders(), chartIndicators: this.chartIndicators(), priceAlerts: this.priceAlerts(), stockIndustries: this.stockIndustries(), costModel: this.costModel(), cashMovements: this.cashMovements(), cashOpeningBalance: this.cashOpeningBalance(), cashTrackingEnabled: this.cashTrackingEnabled(), availableCash: this.availableCash(), maxRiskPerTrade: this.maxRiskPerTrade(),
    maxStockWeight: this.maxStockWeight(), feeDiscount: this.feeDiscount(), financingRate: this.financingRate(), shortBorrowRate: this.shortBorrowRate(),
  }));
  protected readonly hasUnsavedChanges = computed(() => this.workspaceContent() !== this.savedWorkspaceContent());
  protected readonly holdingViewMode = signal<'current' | 'all'>('all');
  protected readonly nearTermDays = signal(5);
  protected readonly presetExpiryDate = signal(this.addBusinessDays(this.firstAvailableTradingDate(), 4));
  protected get presetDateMin(): string { this.todayDate(); return this.firstAvailableTradingDate(); }
  protected get presetDateMax(): string { return this.addBusinessDays(this.presetDateMin, 4); }
  protected readonly calendarCoverageWarning = computed(() => !hasTradingCalendar(this.presetDateMin) || !hasTradingCalendar(this.presetDateMax));
  protected readonly presetOrders = signal<PresetOrder[]>([]);
  protected readonly closedTrades = signal<ClosedTrade[]>([]);
  protected readonly tradePositions = signal<TradePosition[]>([
    {
      id: 'sample-long',
      symbol: '2330',
      type: '現股多單',
      shares: 1000,
      entryPrice: 2425,
      targetPrice: 2600,
      note: '示意持倉',
      tradeDate: '2026-07-18',
    },
    {
      id: 'sample-short',
      symbol: '2330',
      type: '空單',
      shares: 500,
      entryPrice: 2410,
      targetPrice: 2300,
      note: '示意空單',
      tradeDate: '2026-07-25',
    },
  ]);
  protected readonly positionForm = signal<TradePositionInput>({
    symbol: '2330',
    type: '現股多單',
    shares: 1000,
    entryPrice: 2425,
    targetPrice: 2600,
    note: '',
    tradeDate: this.todayInputValue(),
    stopLossPrice: 2300,
  });

  protected readonly chartRangeOptions = [5, 20, 60];

  protected readonly orderOptions = [
    { value: '現股多單' as const, label: '現股多單', detail: '買進持有，預期上漲獲利' },
    { value: '空單' as const, label: '空單', detail: '先賣出、後回補，預期下跌獲利' },
    { value: '融資' as const, label: '融資', detail: '借錢買進，放大上漲收益與成本' },
    { value: '融券' as const, label: '融券', detail: '借券賣空，放大下跌收益與借券成本' },
  ];

  protected readonly minPrice = computed(() => Math.max(this.limitDownPrice(), 1));
  protected readonly maxPrice = computed(() => Math.max(this.limitUpPrice(), this.minPrice()));
  protected readonly valuationPrice = computed(() => this.latestPrice() > 0 ? this.latestPrice() : this.selectedPrice());

  protected readonly selectedPricePercent = computed(() => {
    const min = this.minPrice();
    const max = this.maxPrice();
    const span = Math.max(max - min, 1);
    return ((this.selectedPrice() - min) / span) * 100;
  });

  protected readonly shortTermUpside = computed(() => this.portfolioCalculator.simulateOrder(
    this.selectedPrice(), this.limitUpPrice(), this.orderType(), this.shares(), 1,
    this.financingRate(), this.shortBorrowRate(),
    this.feeDiscount(),
  ));

  protected readonly shortTermDownside = computed(() => this.portfolioCalculator.simulateOrder(
    this.selectedPrice(), this.limitDownPrice(), this.orderType(), this.shares(), 1,
    this.financingRate(), this.shortBorrowRate(),
    this.feeDiscount(),
  ));

  protected readonly longTermProfit = computed(() => {
    const positions = this.currentStockPositions();
    return positions.reduce((total, position) => total + this.portfolioCalculator.simulateOrder(
      position.entryPrice, this.longTermTarget(), position.type, position.shares, this.holdingDays(),
      this.financingRate(), this.shortBorrowRate(),
      this.feeDiscount(),
    ), 0);
  });

  protected readonly longTermRoi = computed(() => {
    const notional = this.currentStockPositions().reduce(
      (total, position) => total + position.entryPrice * position.shares,
      0,
    );
    if (notional === 0) {
      return 0;
    }

    return (this.longTermProfit() / notional) * 100;
  });

  protected readonly shortTermProfitRange = computed(() => {
    return {
      bull: this.shortTermUpside(),
      bear: this.shortTermDownside(),
    };
  });

  protected readonly currentStockHoldingShares = computed(() =>
    this.currentStockPositions().reduce((total, position) => total + position.shares, 0),
  );

  protected readonly currentStockMarketProfit = computed(() =>
    this.currentStockPositions().reduce(
      (total, position) => total + this.portfolioCalculator.positionProfit(position, this.valuationPrice(), this.feeDiscount(), this.calendarDaysBetween(position.tradeDate, this.todayDate()), this.financingRate(), this.shortBorrowRate()),
      0,
    ),
  );

  protected readonly portfolioMarketValue = computed(() => this.tradePositions().reduce(
    (total, position) => total + this.portfolioCalculator.positionMarketValue(position, this.marketPriceForSymbol(position.symbol)), 0,
  ));
  protected readonly portfolioExposure = computed(() => {
    let long = 0, short = 0;
    for (const position of this.tradePositions()) {
      const notional = position.shares * this.marketPriceForSymbol(position.symbol);
      if (position.type === '空單' || position.type === '融券') short += notional;
      else long += notional;
    }
    return { long, short, gross: long + short, net: long - short, ratio: long > 0 ? short / long * 100 : null };
  });
  private readonly analysisHistory = signal<Record<string, StockHistoryPoint[]>>({});
  protected readonly analysisLoading = signal(false);
  protected readonly analysisStatus = signal('');
  protected readonly dailyAnalysis = computed(() => [...new Set(this.tradePositions().map(position => position.symbol))].map(symbol => ({
    symbol, ...compareDailyReturns(this.analysisHistory()[symbol] ?? [], this.analysisHistory()['0050'] ?? []),
  })));
  protected readonly pairwiseCorrelations = computed(() => {
    const symbols = this.dailyAnalysis().map(row => row.symbol);
    return symbols.flatMap((left, index) => symbols.slice(index + 1).map(right => ({ left, right,
      ...compareDailyReturns(this.analysisHistory()[left] ?? [], this.analysisHistory()[right] ?? []),
    })));
  });
  protected readonly betaExposure = computed(() => {
    const rows = this.dailyAnalysis();
    let value = 0;
    const missing: string[] = [];
    for (const row of rows) {
      const price = this.latestPrices()[row.symbol] ?? (row.symbol === this.stockSymbol() ? this.latestPrice() : 0);
      if (row.beta === null || !(price > 0)) { missing.push(row.symbol); continue; }
      value += this.tradePositions().filter(position => position.symbol === row.symbol).reduce((sum, position) => sum + position.shares * price * (position.type === '空單' || position.type === '融券' ? -1 : 1) * row.beta!, 0);
    }
    return { value, missing };
  });
  protected loadDailyAnalysis(): void {
    if (this.analysisLoading()) return;
    const symbols = [...new Set(['0050', ...this.tradePositions().map(position => position.symbol)])];
    if (symbols.length > 11) { this.analysisStatus.set('目前單次最多 10 檔持倉股票，避免過量請求。'); return; }
    const date = this.todayInputValue();
    this.analysisLoading.set(true);
    this.analysisStatus.set('正在取得最多 120 交易日資料…');
    forkJoin(symbols.map(symbol => this.stockPriceService.getHistory(symbol, 120, date))).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: histories => { this.analysisHistory.set(Object.fromEntries(symbols.map((symbol, i) => [symbol, histories[i]]))); this.analysisLoading.set(false); this.analysisStatus.set(`日行情取得日期 ${date}；需至少 30 組同起訖交易日報酬，資料不足或零變異不計算。`); },
      error: () => { this.analysisLoading.set(false); this.analysisStatus.set('資料取得失敗，請稍後重試。'); },
    });
  }
  protected readonly portfolioStress = computed(() => {
    const symbols = [...new Set([...this.tradePositions().map(position => position.symbol), ...this.presetOrders().filter(order => !this.isPresetExpired(order)).map(order => order.symbol)])];
    const priceFor = (symbol: string) => this.latestPrices()[symbol] ?? (symbol === this.stockSymbol() ? this.latestPrice() : 0);
    const missing = symbols.filter(symbol => !(priceFor(symbol) > 0));
    const scenarios = [
      { name: '全部逐步下跌 10%', shock: -0.1, stops: true },
      { name: '全部逐步上漲 10%', shock: 0.1, stops: true },
      { name: '全部跳空下跌 10%', shock: -0.1, stops: false },
      { name: '全部跳空上漲 10%', shock: 0.1, stops: false },
    ].map((option, index) => {
      const rows = symbols.filter(symbol => priceFor(symbol) > 0).map(symbol => ({ symbol, scenario: this.buildStockStressScenario(`portfolio-${index}-${symbol}`, option.name, '同幅度衝擊', option.shock, option.stops, symbol, priceFor(symbol)) }));
      return { name: option.name, rows, total: rows.reduce((sum, row) => sum + row.scenario.totalProfit, 0), change: rows.reduce((sum, row) => sum + row.scenario.changeFromNow, 0), exposure: rows.reduce((sum, row) => sum + row.scenario.stressedExposure, 0) };
    });
    return { missing, scenarios, count: symbols.length - missing.length };
  });

  protected readonly portfolioCost = computed(() => this.tradePositions().reduce(
    (total, position) => total + this.portfolioCalculator.positionCost(position), 0,
  ));

  protected readonly portfolioUnrealizedProfit = computed(() => this.tradePositions().reduce(
    (total, position) => total + this.portfolioCalculator.positionProfit(position, this.marketPriceForSymbol(position.symbol), this.feeDiscount(), this.calendarDaysBetween(position.tradeDate, this.todayDate()), this.financingRate(), this.shortBorrowRate()), 0,
  ));

  protected readonly portfolioRealizedProfit = computed(() => this.closedTrades().reduce(
    (total, trade) => total + trade.realizedProfit, 0,
  ));

  protected readonly pendingOrderCapital = computed(() => this.presetOrders().filter(order => !this.isPresetExpired(order)).reduce(
    (total, order) => total + (order.action === 'sell' ? 0 : this.portfolioCalculator.entryCapital(order.entryPrice, order.type, order.shares, this.feeDiscount())), 0,
  ));

  protected readonly cashAfterPendingOrders = computed(() => this.availableCash() - this.pendingOrderCapital());

  protected readonly portfolioConcentration = computed(() => {
    const total = Math.max(this.portfolioMarketValue(), 1);
    return this.positionProfitSummary().map((summary) => ({
      symbol: summary.symbol,
      value: this.tradePositions().filter((position) => position.symbol === summary.symbol)
        .reduce((sum, position) => sum + this.portfolioCalculator.positionMarketValue(position, this.marketPriceForSymbol(position.symbol)), 0),
    })).map((item) => ({ ...item, weight: item.value / total * 100 })).sort((left, right) => right.weight - left.weight);
  });

  protected readonly proposedStopLoss = computed(() => {
    const value = this.positionForm().stopLossPrice;
    return value && value > 0 ? value : undefined;
  });
  protected readonly pricePlanningError = computed(() => {
    const form = this.positionForm();
    if (this.presetOrderAction() === 'sell') return '';
    const short = form.type === '空單' || form.type === '融券';
    if (form.stopLossPrice !== undefined && (short ? form.stopLossPrice <= form.entryPrice : form.stopLossPrice >= form.entryPrice))
      return short ? '空單停損須高於進場價。' : '多單停損須低於進場價。';
    if (form.targetPrice > 0 && (short ? form.targetPrice >= form.entryPrice : form.targetPrice <= form.entryPrice))
      return short ? '空單獲利目標須低於進場價。' : '多單獲利目標須高於進場價。';
    return '';
  });
  protected readonly riskPerShare = computed(() => {
    const form = this.positionForm();
    if (this.pricePlanningError() || this.proposedStopLoss() === undefined) return null;
    return Math.max(0, -this.portfolioCalculator.simulateOrder(form.entryPrice, this.proposedStopLoss()!, form.type, 1,
      this.nearTermDays(), this.financingRate(), this.shortBorrowRate(), this.feeDiscount()));
  });
  protected readonly suggestedRiskShares = computed(() => {
    const risk = this.riskPerShare();
    if (!risk || this.presetOrderAction() === 'sell') return 0;
    const editing = this.presetOrders().find(order => order.id === this.editingPresetOrderId());
    const credit = editing && editing.action !== 'sell' && !this.isPresetExpired(editing) ? this.portfolioCalculator.entryCapital(editing.entryPrice, editing.type, editing.shares, this.feeDiscount()) : 0;
    const budget = Math.max(this.availableCash() - this.pendingOrderCapital() + credit, 0);
    const form = this.positionForm();
    const raw = this.portfolioCalculator.sizeByRiskAndCash(form.entryPrice, this.proposedStopLoss()!, form.type, this.maxRiskPerTrade(), budget, this.nearTermDays(), this.financingRate(), this.shortBorrowRate(), this.feeDiscount());
    return this.shareUnit() === 'boardLot' ? Math.floor(raw / 1000) * 1000 : Math.min(raw, 999);
  });
  protected readonly proposedOrderRisk = computed(() => {
    const stopLoss = this.proposedStopLoss();
    return stopLoss === undefined || this.pricePlanningError() ? null : Math.max(0, -this.portfolioCalculator.simulateOrder(
      this.positionForm().entryPrice, stopLoss, this.positionForm().type, this.positionForm().shares, this.nearTermDays(),
      this.financingRate(), this.shortBorrowRate(), this.feeDiscount(),
    ));
  });
  protected readonly proposedOrderReward = computed(() => {
    const targetPrice = this.positionForm().targetPrice;
    return targetPrice > 0 && !this.pricePlanningError() ? this.portfolioCalculator.simulateOrder(
      this.positionForm().entryPrice, targetPrice, this.positionForm().type, this.positionForm().shares,
      this.nearTermDays(), this.financingRate(), this.shortBorrowRate(), this.feeDiscount(),
    ) : null;
  });  protected readonly proposedRiskRewardRatio = computed(() => {
    const risk = this.proposedOrderRisk(), reward = this.proposedOrderReward();
    return risk !== null && risk > 0 && reward !== null ? reward / risk : null;
  });

  protected readonly backtestResult = computed<BacktestResult>(() => this.portfolioCalculator.backtest(
    this.history().map((point) => point.close), this.positionForm().type, 100_000,
  ));
  protected readonly plannedTradeResult = computed(() => {
    const form = this.positionForm();
    return simulatePlannedTrade(this.history(), { entry: form.entryPrice, stop: form.stopLossPrice,
      target: form.targetPrice > 0 ? form.targetPrice : undefined, shares: form.shares, type: form.type,
      capital: this.availableCash(), feeDiscount: this.feeDiscount(), financingRate: this.financingRate(), borrowRate: this.shortBorrowRate() }, this.portfolioCalculator);
  });

  protected readonly stressScenarios = computed<StressScenario[]>(() => {
    const directionalScenarios = [
      { id: 'up-5', name: '上漲 5%', assumption: '盤中逐步上漲 5%，可觸發目標價或停損', shock: 0.05, respectStops: true },
      { id: 'up-10', name: '上漲 10%', assumption: '盤中逐步上漲 10%，可觸發目標價或停損', shock: 0.1, respectStops: true },
      { id: 'down-5', name: '下跌 5%', assumption: '盤中逐步下跌 5%，可觸發目標價或停損', shock: -0.05, respectStops: true },
      { id: 'down-10', name: '下跌 10%', assumption: '盤中逐步下跌 10%，可觸發目標價或停損', shock: -0.1, respectStops: true },
      { id: 'gap-up', name: '跳空漲停', assumption: '開盤直接上漲 10%，中間停損／目標價無法成交', shock: 0.1, respectStops: false },
      { id: 'gap-down', name: '跳空跌停', assumption: '開盤直接下跌 10%，中間停損／目標價無法成交', shock: -0.1, respectStops: false },
    ].map((scenario) => this.buildStockStressScenario(scenario.id, scenario.name, scenario.assumption, scenario.shock, scenario.respectStops));
    const rangeCandidates = [
      this.buildStockStressScenario('range-2-down', '漲跌低於 2%', '隔日漲跌介於 -2% 至 +2%，顯示較不利的一端', -0.02, true),
      this.buildStockStressScenario('range-2-up', '漲跌低於 2%', '隔日漲跌介於 -2% 至 +2%，顯示較不利的一端', 0.02, true),
    ];
    const rangeScenario = rangeCandidates.reduce((worse, candidate) =>
      candidate.totalProfit < worse.totalProfit ? candidate : worse,
    );
    return [{ ...rangeScenario, id: 'range-2' }, ...directionalScenarios];
  });

  protected readonly dayBias = computed(() => {
    const profit = this.shortTermProfitRange();
    return profit.bull >= profit.bear ? '偏多' : '偏空';
  });

  protected readonly positionSummary = computed(() => {
    const direction = this.orderType();
    if (direction === '現股多單' || direction === '融資') {
      return '看好盤勢，買進後以更高價格出場';
    }

    return '看淡盤勢，先賣出再回補，等待下跌獲利';
  });

  protected readonly positionProfitSummary = computed(() => {
    const bySymbol = new Map<string, { symbol: string; profit: number; shares: number; positions: number }>();

    for (const position of this.tradePositions()) {
      const profit = this.portfolioCalculator.positionProfit(position, this.marketPriceForSymbol(position.symbol), this.feeDiscount(), this.calendarDaysBetween(position.tradeDate, this.todayDate()), this.financingRate(), this.shortBorrowRate());
      const current = bySymbol.get(position.symbol) ?? {
        symbol: position.symbol,
        profit: 0,
        shares: 0,
        positions: 0,
      };

      current.profit += profit;
      current.shares += position.shares;
      current.positions += 1;
      bySymbol.set(position.symbol, current);
    }

    return Array.from(bySymbol.values()).sort((left, right) => right.profit - left.profit);
  });

  protected readonly currentStockPositions = computed(() =>
    this.tradePositions().filter((position) => position.symbol === this.stockSymbol()),
  );

  protected readonly currentStockPresetOrders = computed(() =>
    this.presetOrders().filter((order) => order.symbol === this.stockSymbol()),
  );

  protected readonly sellableFormStockPositions = computed(() => {
    const symbol = this.positionForm().symbol.trim();
    return this.tradePositions().filter((position) =>
      position.symbol === symbol && (position.type === '現股多單' || position.type === '融資'));
  });

  protected readonly sellableFormStockShares = computed(() =>
    this.sellableFormStockPositions().reduce((total, position) => total + position.shares, 0),
  );

  protected readonly canCreateSellPreset = computed(() => this.sellableFormStockShares() > 0);
  protected readonly matchingSellHoldings = computed(() => this.sellableFormStockPositions()
    .filter(position => position.type === this.positionForm().type).reduce((sum, position) => sum + position.shares, 0));
  protected readonly reservedSellShares = computed(() => this.presetOrders()
    .filter(order => order.action === 'sell' && order.symbol === this.positionForm().symbol.trim() && order.type === this.positionForm().type
      && !this.isPresetExpired(order) && order.id !== this.editingPresetOrderId())
    .reduce((sum, order) => sum + order.shares, 0));
  protected readonly availableSellOrderShares = computed(() => Math.max(0, this.matchingSellHoldings() - this.reservedSellShares()));
  protected readonly oversubscribedSellOrders = computed(() => {
    const groups = new Map<string, { symbol: string; type: OrderType; reserved: number; held: number }>();
    for (const order of this.presetOrders().filter(order => order.action === 'sell' && !this.isPresetExpired(order))) {
      const key = `${order.symbol}:${order.type}`;
      const group = groups.get(key) ?? { symbol: order.symbol, type: order.type, reserved: 0,
        held: this.tradePositions().filter(position => position.symbol === order.symbol && position.type === order.type).reduce((sum, position) => sum + position.shares, 0) };
      group.reserved += order.shares;
      groups.set(key, group);
    }
    return [...groups.values()].filter(group => group.reserved > group.held);
  });

  protected readonly visibleHoldingPositions = computed(() => this.holdingViewMode() === 'current'
    ? this.currentStockPositions() : this.tradePositions());

  protected readonly currentStockProfitSummary = computed(() =>
    this.positionProfitSummary().filter((summary) => summary.symbol === this.stockSymbol()),
  );

  protected readonly orderTypeHint = computed(() => {
    const type = this.orderType();
    if (type === '融資') {
      return '融資需要考慮借款成本與保證金需求';
    }

    if (type === '融券') {
      return '融券需要考慮借券成本與放空風險';
    }

    return '現股與空單的交易成本較低，簡單適合快速模擬';
  });

  protected readonly chartPath = computed(() => {
    const points = this.history();
    if (points.length === 0) {
      return '';
    }

    const width = 760;
    const height = 300;
    const padding = 18;
    const prices = points.map((point) => point.close);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = Math.max(max - min, 1);

    return points
      .map((point, index) => {
        const x = padding + index * ((width - padding * 2) / Math.max(points.length - 1, 1));
        const y = height - padding - ((point.close - min) / span) * (height - padding * 2);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  });

  protected readonly areaPath = computed(() => {
    const linePath = this.chartPath();
    if (!linePath) {
      return '';
    }

    return `${linePath} L 742 282 L 18 282 Z`;
  });

  protected readonly chartPriceTicks = computed(() => {
    const points = this.history();
    if (!points.length) return [];
    const min = Math.min(...points.map((point) => point.low));
    const max = Math.max(...points.map((point) => point.high));
    const span = Math.max(max - min, 1);
    return Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      return { value: max - span * ratio, y: 18 + ratio * 264 };
    });
  });

  protected readonly chartDateTicks = computed(() => {
    const points = this.history();
    if (!points.length) return [];
    const indices = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
    return indices.map((index) => ({
      label: points[index].date,
      x: 18 + index * (724 / Math.max(points.length - 1, 1)),
    }));
  });

  protected readonly candleBars = computed<CandleBar[]>(() => {
    const points = this.history();
    if (points.length === 0) {
      return [];
    }

    const width = 760;
    const height = 300;
    const padding = 18;
    const interval = (width - padding * 2) / Math.max(points.length, 1);
    const min = Math.min(...points.map((point) => point.low));
    const max = Math.max(...points.map((point) => point.high));
    const span = Math.max(max - min, 1);
    const chartHeight = height - padding * 2;

    return points.map((point, index) => {
      const x = padding + index * interval + interval * 0.2;
      const candleWidth = Math.max(6, interval * 0.45);
      const openY = height - padding - ((point.open - min) / span) * chartHeight;
      const closeY = height - padding - ((point.close - min) / span) * chartHeight;
      const highY = height - padding - ((point.high - min) / span) * chartHeight;
      const lowY = height - padding - ((point.low - min) / span) * chartHeight;
      const y = Math.min(openY, closeY);
      const barHeight = Math.max(Math.abs(closeY - openY), 3);

      return {
        date: point.date,
        x,
        y,
        width: candleWidth,
        height: barHeight,
        highY,
        lowY,
        fill: point.close > point.open ? '#ff6268' : point.close < point.open ? '#38d996' : '#a9b6c9',
      };
    });
  });

  protected readonly volumeBars = computed<VolumeBar[]>(() => {
    const points = this.history();
    if (points.length === 0) {
      return [];
    }

    const width = 760;
    const height = 140;
    const padding = 14;
    const interval = (width - padding * 2) / Math.max(points.length, 1);
    const maxVolume = Math.max(...points.map((point) => point.volume), 1);

    return points.map((point, index) => {
      const x = padding + index * interval + interval * 0.2;
      const barWidth = Math.max(6, interval * 0.45);
      const barHeight = (point.volume / maxVolume) * (height - 20);
      const y = height - 8 - barHeight;

      return {
        date: point.date,
        x,
        y,
        width: barWidth,
        height: barHeight,
        fill: point.close > point.open ? 'rgba(255, 98, 104, .72)' : point.close < point.open ? 'rgba(56, 217, 150, .72)' : 'rgba(169, 182, 201, .65)',
      };
    });
  });

  protected readonly latestSession = computed(() => {
    const points = this.history();
    return this.quoteSession() ?? points[points.length - 1] ?? null;
  });
  private readonly quoteSession = signal<StockHistoryPoint | null>(null);

  protected readonly boardAxis = computed(() => {
    const [start, end] = this.boardTimeRange();
    return {
      minPrice: this.boardMinPrice(),
      maxPrice: this.boardMaxPrice(),
      startLabel: this.formatBoardDate(start),
      endLabel: this.formatBoardDate(end),
    };
  });

  protected readonly boardMarkers = computed<BoardMarker[]>(() => {
    const positions = this.currentStockPositions();
    if (positions.length === 0) return [];
    const minPrice = this.boardMinPrice();
    const priceSpan = Math.max(this.boardMaxPrice() - minPrice, 1);
    return positions.map((position, index) => {
      const columns = Math.max(Math.min(positions.length, 3), 1);
      return {
        id: position.id,
        x: 90 + (index % columns) * (135 / Math.max(columns - 1, 1)),
        y: 250 - ((position.entryPrice - minPrice) / priceSpan) * 210,
        label: `${position.symbol} ${position.shares}股`,
        fill: this.colorForBoardType(position.type),
        position,
        dateLabel: '既有持倉',
      };
    });
  });

  protected readonly presetMarkers = computed<PresetMarker[]>(() => {
    const minPrice = this.boardMinPrice();
    const priceSpan = Math.max(this.boardMaxPrice() - minPrice, 1);
    const [startTime, endTime] = this.boardTimeRange();
    const timeSpan = Math.max(endTime - startTime, 1);
    return this.currentStockPresetOrders().map((order) => ({
      id: order.id,
      x: 280 + ((this.presetTimestamp(order) - startTime) / timeSpan) * 455,
      y: 250 - ((order.entryPrice - minPrice) / priceSpan) * 210,
      label: `預設 ${order.symbol} ${order.entryPrice}`,
      order,
      dateLabel: this.formatBoardDate(this.presetTimestamp(order)),
    }));
  });

  constructor(
    private readonly stockPriceService: StockPriceService,
    private readonly portfolioCalculator: PortfolioCalculatorService,
  ) {
    this.restoreWorkspace();
    effect(onCleanup => {
      const content = this.workspaceContent();
      const enabled = this.autoSaveEnabled();
      if (!enabled || this.storageConflict() || content === untracked(this.savedWorkspaceContent)) return;
      const pendingSave = setTimeout(() => this.saveWorkspace(), 1000);
      onCleanup(() => clearTimeout(pendingSave));
    });
    this.loadCurrentPrice();
    timer(30000, 30000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.refreshCalendar();
      if (this.liveEnabled() && document.visibilityState === 'visible') this.refreshIntraday();
    });
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === this.workspaceStorageKey || event.key === null) && localStorage.getItem(this.workspaceStorageKey) !== this.expectedStoredWorkspace) {
        this.storageConflict.set(true);
        this.autoSaveEnabled.set(false);
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') this.refreshCalendar(); };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => { window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onVisible); });
  }

  protected toggleLive(): void {
    if (this.requestedDate() !== this.todayDate()) { this.liveStatus.set('歷史日期查詢：暫停盤中更新'); return; }
    if (!isTradingDate(this.todayDate())) { this.liveStatus.set('今日休市，暫停盤中更新'); return; }
    this.liveEnabled.update(value => !value);
    ++this.liveRequestId;
    this.liveLoading.set(false);
    this.liveStatus.set('');
    if (this.liveEnabled()) this.refreshIntraday();
  }

  private refreshIntraday(): void {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    if (!isTradingDate(today)) {
      this.liveStatus.set('今日休市，暫停盤中更新');
      return;
    }
    if (this.requestedDate() !== today) {
      this.liveStatus.set('歷史日期查詢：暫停盤中更新');
      return;
    }
    if (this.liveLoading() || this.historyLoading() || !this.indicatorHistory().length) return;
    const symbol = this.stockSymbol();
    const requestId = ++this.liveRequestId;
    this.liveLoading.set(true);
    this.stockPriceService.getIntradayQuote(symbol).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(quote => {
      if (requestId !== this.liveRequestId || symbol !== this.stockSymbol() || this.requestedDate() !== today || !this.liveEnabled()) return;
      this.liveLoading.set(false);
      if (!quote || quote.date !== today.replaceAll('-', '')) {
        this.liveStatus.set('無當日有效成交行情，保留歷史資料');
        return;
      }
      const date = `${Number(quote.date.slice(0, 4)) - 1911}/${quote.date.slice(4, 6)}/${quote.date.slice(6, 8)}`;
      const points = this.indicatorHistory().filter(point => point.date !== date);
      points.push({ ...quote, date });
      this.indicatorHistory.set(points);
      this.history.set(points.slice(-this.chartDays()));
      this.latestPrice.set(quote.close);
      this.quoteDate.set(date);
      this.quoteSession.set(quote);
      this.quoteChange.set(quote.change);
      this.quoteSource.set(quote.source ?? 'MIS');
      this.quoteSourceTime.set(quote.quoteTime ?? '未提供');
      this.quoteFetchedAt.set(this.formatSavedTime(new Date()));
      this.latestPrices.update(prices => ({ ...prices, [symbol]: quote.close }));
      this.liveStatus.set(`行情時間 ${date} ${quote.quoteTime || '未提供'}（台北）・30 秒輪詢，來源可能延遲`);
    });
  }

  protected saveWorkspace(): void {
    this.saveError.set('');
    try {
      if (typeof localStorage === 'undefined') throw new Error('Storage unavailable');
      if (this.storageConflict() || localStorage.getItem(this.workspaceStorageKey) !== this.expectedStoredWorkspace) {
        this.storageConflict.set(true);
        this.autoSaveEnabled.set(false);
        return;
      }
      if (this.workspaceContent() === this.savedWorkspaceContent()) return;
      const raw = this.workspaceBackupJson();
      localStorage.setItem(this.workspaceStorageKey, raw);
      this.expectedStoredWorkspace = raw;
      this.savedWorkspaceContent.set(this.workspaceContent());
      this.saveStatus.set(`已儲存 ${this.formatSavedTime(new Date())}（台北）`);
    } catch {
      this.saveError.set('儲存失敗，資料仍保留在目前頁面。請檢查瀏覽器儲存權限或空間後，按「立即儲存」重試。');
    }
  }

  private workspaceBackupJson(): string {
    return JSON.stringify({ version: 1, savedAt: new Date().toISOString(), ...JSON.parse(this.workspaceContent()) }, null, 2);
  }
  private tradeCostSnapshot(entry: number, exit: number, type: OrderType, shares: number, days: number, position?: TradePosition) {
    return {
      costBreakdown: position ? this.portfolioCalculator.positionExitCosts(position, exit, shares, days, this.financingRate(), this.shortBorrowRate(), this.feeDiscount()) : this.portfolioCalculator.tradeCosts(entry, exit, type, shares, days, this.financingRate(), this.shortBorrowRate(), this.feeDiscount()),
      costAssumptions: { ...this.costModel(), feeDiscount: this.feeDiscount(), financingRate: this.financingRate(), borrowRate: this.shortBorrowRate(), holdingDays: days, recordedAt: new Date().toISOString() },
    };
  }
  private reducePositionShares(position: TradePosition, sold: number): TradePosition {
    const fraction = position.shares > 0 ? (position.shares - sold) / position.shares : 0;
    return { ...position, shares: position.shares - sold, entryFeePaid: position.entryFeePaid === undefined ? undefined : position.entryFeePaid * fraction, entryTaxPaid: position.entryTaxPaid === undefined ? undefined : position.entryTaxPaid * fraction };
  }

  private formatSavedTime(date: Date): string {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(date);
  }

  protected downloadWorkspaceBackup(): void {
    this.backupStatus.set('');
    let downloadUrl: string | undefined;
    try {
      const blob = new Blob([this.workspaceBackupJson()], { type: 'application/json;charset=utf-8' });
      downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `stock-workspace-${this.todayInputValue()}-${Date.now()}.json`;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
      this.backupStatus.set('已送出備份下載，請到瀏覽器下載清單確認 JSON 檔案。');
    } catch {
      this.backupStatus.set('無法下載備份，請檢查瀏覽器下載權限後重試。');
    } finally {
      if (downloadUrl) setTimeout(() => URL.revokeObjectURL(downloadUrl!), 1000);
    }
  }

  protected loadCurrentPrice(): void {
    this.quoteSession.set(null);
    this.quoteChange.set(0);
    this.turnover.set(0);
    this.quoteFetchedAt.set('');
    this.quoteSource.set('');
    this.quoteSourceTime.set('');
    this.latestPrice.set(this.latestPrices()[this.stockSymbol()] ?? 0);
    this.quoteDate.set(this.stockRecords().find(record => record.symbol === this.stockSymbol())?.quoteDate ?? '');
    const quoteRequestId = ++this.quoteRequestId;
    ++this.historyRequestId;
    this.historyLoading.set(false);
    this.indicatorHistory.set([]);
    this.history.set([]);
    this.tooltip.set(null);
    ++this.liveRequestId;
    this.liveLoading.set(false);
    this.liveStatus.set('');
    const requestedSymbol = this.stockSymbol();
    const requestedDate = this.requestedDate();
    this.isLoadingQuote.set(true);
    this.quoteError.set('');

    this.stockPriceService.getLatestQuote(requestedSymbol, this.requestedDate()).subscribe({
      next: (quote) => {
        if (quoteRequestId !== this.quoteRequestId || requestedSymbol !== this.stockSymbol() || requestedDate !== this.requestedDate()) return;
        this.isLoadingQuote.set(false);

        if (!quote) {
          this.quoteError.set('查無此股票的最近成交資料，請確認股票代號。');
          if (this.recordQuoteLoading() === requestedSymbol) {
            this.recordQuoteLoading.set('');
            this.recordQuoteError.set(`查無 ${requestedSymbol} 的股價資料。若是上櫃股票，請確認網站已啟用 TPEx 資料代理。`);
          }
          this.history.set([]);
          return;
        }

        this.quoteDate.set(quote.date);
        this.quoteSession.set(quote);
        this.quoteChange.set(quote.change);
        this.quoteSource.set(quote.source ?? '未提供');
        this.quoteSourceTime.set(quote.quoteTime ?? '日行情無盤中時間');
        this.quoteFetchedAt.set(this.formatSavedTime(new Date()));
        this.latestPrice.set(quote.close);
        this.latestPrices.update((prices) => ({ ...prices, [requestedSymbol]: quote.close }));
        this.upsertStockRecord(requestedSymbol, quote.name || requestedSymbol, quote.close, quote.change, quote.date);
        if (this.recordQuoteLoading() === requestedSymbol) {
          this.recordQuoteLoading.set('');
          this.recordQuoteError.set('');
        }
        this.turnover.set(quote.turnover);
        this.selectedPrice.set(quote.close);
        this.limitUpPrice.set(Math.max(quote.high, quote.close));
        this.limitDownPrice.set(Math.min(quote.low, quote.close));
        this.stockName.set(this.stockRecords().find(record => record.symbol === requestedSymbol)?.name ?? '');
        this.quoteError.set('');

        if (this.stockSymbol() === requestedSymbol && !this.editingPositionId() && !this.editingPresetOrderId() && !this.orderDraftEdited) {
          this.syncOrderFormToStock(requestedSymbol, quote.close);
        }

        this.loadHistory();
      },
      error: () => {
        if (quoteRequestId !== this.quoteRequestId || requestedSymbol !== this.stockSymbol() || requestedDate !== this.requestedDate()) return;
        this.isLoadingQuote.set(false);
        this.quoteError.set('無法讀取股價資料，請稍後再試。');
        if (this.recordQuoteLoading() === requestedSymbol) {
          this.recordQuoteLoading.set('');
          this.recordQuoteError.set(`${requestedSymbol} 股價請求失敗，請確認資料代理服務已啟用。`);
        }
      },
    });
  }

  protected onSymbolChange(value: string): void {
    this.stockSymbol.set(value.trim() || '2330');
    this.loadCurrentPrice();
  }

  protected onDateChange(value: string): void {
    if (value > this.todayInputValue()) {
      this.quoteError.set('請選擇今天或之前的日期。');
      return;
    }
    this.requestedDate.set(value || this.todayInputValue());
    this.loadCurrentPrice();
  }

  protected onChartRangeChange(days: number): void {
    this.chartDays.set(days);
    this.history.set(this.indicatorHistory().slice(-days));
  }

  protected returnToToday(): void {
    this.onDateChange(this.todayInputValue());
  }

  protected onBoardMarkerPointerDown(markerId: string, event: MouseEvent): void {
    if (event.button !== 0) {
      return;
    }

    this.draggingBoardMarker.set(markerId);
    this.boardTooltip.set(null);
    event.preventDefault();
  }

  protected onBoardPointerMove(event: MouseEvent): void {
    const activeId = this.draggingBoardMarker();
    if (!activeId) {
      return;
    }

    const nextPrice = this.priceFromBoardY(event.offsetY);
    if (!Number.isFinite(nextPrice)) {
      return;
    }

    const roundedPrice = Math.round(nextPrice);

    this.tradePositions.update((current) =>
      current.map((position) =>
        position.id === activeId ? { ...position, entryPrice: roundedPrice } : position,
      ),
    );

    if (this.editingPositionId() === activeId) {
      this.onPositionFieldChange('entryPrice', roundedPrice);
    }
  }

  protected onBoardPointerUp(): void {
    this.draggingBoardMarker.set(null);
  }

  protected onBoardMarkerHover(position: TradePosition, event: MouseEvent): void {
    this.boardTooltip.set({
      x: event.offsetX + 12,
      y: event.offsetY + 12,
      position,
    });
    this.tooltip.set(null);
  }

  protected onBoardMarkerLeave(): void {
    this.boardTooltip.set(null);
  }

  protected selectBoardRecord(id: string, kind: 'position' | 'preset', x: number, y: number): void {
    this.selectedBoardRecord.set({ id, kind, x: x + 12, y: y + 12 });
    this.pendingBoardRecordDelete.set(null);
  }

  protected editSelectedBoardRecord(): void {
    const selected = this.selectedBoardRecord();
    if (!selected) return;
    if (selected.kind === 'position') {
      const position = this.tradePositions().find((item) => item.id === selected.id);
      if (position) this.editTradePosition(position);
    } else {
      const order = this.presetOrders().find((item) => item.id === selected.id);
      if (order) this.editPresetOrder(order);
    }
    this.selectedBoardRecord.set(null);
  }

  protected requestSelectedBoardRecordDelete(): void {
    const selected = this.selectedBoardRecord();
    if (selected) this.pendingBoardRecordDelete.set(selected.id);
  }

  protected confirmSelectedBoardRecordDelete(): void {
    const selected = this.selectedBoardRecord();
    if (!selected || this.pendingBoardRecordDelete() !== selected.id) return;
    selected.kind === 'position' ? this.removeTradePosition(selected.id) : this.removePresetOrder(selected.id);
    this.selectedBoardRecord.set(null);
    this.pendingBoardRecordDelete.set(null);
  }

  protected cancelSelectedBoardRecord(): void {
    this.selectedBoardRecord.set(null);
    this.pendingBoardRecordDelete.set(null);
  }

  protected editTradePosition(position: TradePosition): void {
    this.orderEntryMode.set('holding');
    this.editingPresetOrderId.set(null);
    this.editingPositionId.set(position.id);
    this.shareUnit.set(position.shares >= 1000 && position.shares % 1000 === 0 ? 'boardLot' : 'oddLot');
    this.positionForm.set({
      symbol: position.symbol,
      type: position.type,
      shares: position.shares,
      entryPrice: position.entryPrice,
      targetPrice: position.targetPrice,
      note: position.note,
      tradeDate: position.tradeDate ?? this.todayInputValue(),
      stopLossPrice: position.stopLossPrice ?? position.entryPrice,
    });
  }

  protected editPresetOrder(order: PresetOrder): void {
    this.pendingPresetCancel.set(null);
    this.orderStatus.set(`正在編輯 ${order.symbol} 待成交委託，儲存後更新原單。`);
    this.orderEntryMode.set('preset');
    this.editingPositionId.set(null);
    this.editingPresetOrderId.set(order.id);
    this.presetOrderAction.set(order.action ?? 'buy');
    this.shareUnit.set(order.shareUnit ?? (order.shares >= 1000 && order.shares % 1000 === 0 ? 'boardLot' : 'oddLot'));
    if (order.expiryDate) this.onPresetExpiryChange(order.expiryDate);
    this.positionForm.set({
      symbol: order.symbol,
      type: order.type,
      shares: order.shares,
      entryPrice: order.entryPrice,
      targetPrice: order.exitPrice ?? 0,
      note: order.note ?? '',
      tradeDate: this.todayInputValue(),
      stopLossPrice: order.stopLossPrice,
    });
  }

  protected onPositionInlineChange(change: PositionInlineChange): void {
    this.tradePositions.update((positions) =>
      positions.map((position) => {
        if (position.id !== change.id) return position;
        if (change.field === 'note') return { ...position, note: String(change.value) };
        if (change.field === 'stopLossPrice') return { ...position, stopLossPrice: Number(change.value) };
        return { ...position, targetPrice: Number(change.value) };
      }),
    );
  }

  protected onPositionFieldChange<K extends keyof TradePositionInput>(field: K, value: TradePositionInput[K]): void {
    if (field === 'stopLossPrice' || field === 'targetPrice') this.editedPlanningPrices.add(field);
    this.orderDraftEdited = true;
    this.orderStatus.set('');
    this.positionForm.update((current) => ({ ...current, [field]: value }));
    if (field === 'type' && !this.editingPositionId() && !this.editingPresetOrderId() && this.presetOrderAction() !== 'sell') {
      const form = this.positionForm(), short = form.type === '空單' || form.type === '融券';
      if (form.entryPrice > 0) this.positionForm.update(current => ({ ...current,
        stopLossPrice: this.editedPlanningPrices.has('stopLossPrice') ? current.stopLossPrice : +(form.entryPrice * (short ? 1.05 : .95)).toFixed(2),
        targetPrice: this.editedPlanningPrices.has('targetPrice') ? current.targetPrice : +(form.entryPrice * (short ? .95 : 1.05)).toFixed(2),
      }));
    }
  }

  protected resetDirectionPrices(): void {
    const form = this.positionForm(), short = form.type === '空單' || form.type === '融券';
    if (!(form.entryPrice > 0)) return;
    this.orderDraftEdited = true;
    this.editedPlanningPrices.clear();
    this.positionForm.update(value => ({ ...value, stopLossPrice: +(form.entryPrice * (short ? 1.05 : .95)).toFixed(2), targetPrice: +(form.entryPrice * (short ? .95 : 1.05)).toFixed(2) }));
    this.orderStatus.set('已依方向重設停損與目標為進場價上下 5%，請自行確認。');
  }

  protected stockLabel(symbol: string, name?: string): string { return name?.trim() && name.trim() !== symbol ? `${symbol} · ${name.trim()}` : symbol; }

  protected onPresetOrderActionChange(value: PresetOrderAction): void {
    if (value === 'sell' && !this.canCreateSellPreset()) return;
    this.orderDraftEdited = true;
    this.presetOrderAction.set(value);
    if (value === 'sell') {
      const holding = this.sellableFormStockPositions()[0];
      this.positionForm.update((form) => ({ ...form, type: holding.type, shares: Math.min(form.shares, this.sellableFormStockShares()) }));
    }
  }

  protected onShareUnitChange(value: 'boardLot' | 'oddLot'): void {
    this.orderDraftEdited = true;
    this.shareUnit.set(value);
    this.orderStatus.set('已切換交易單位，股數保持不變；請依欄位提示確認數量。');
  }

  protected onPresetExpiryChange(value: string): void {
    const normalized = this.clampPresetDate(value);
    this.presetExpiryDate.set(normalized);
    this.nearTermDays.set(this.businessDaysThrough(normalized));
  }

  protected onSimulationShareUnitChange(value: 'boardLot' | 'oddLot'): void {
    this.simulationShareUnit.set(value);
    this.shares.set(value === 'boardLot'
      ? Math.max(1000, Math.round(this.shares() / 1000) * 1000)
      : Math.min(Math.max(Math.round(this.shares()), 1), 999));
  }

  protected applyLongTermTargetToPositions(): void {
    const symbol = this.stockSymbol();
    const targetPrice = Math.max(this.longTermTarget(), 1);
    this.tradePositions.update((positions) => positions.map((position) =>
      position.symbol === symbol ? { ...position, targetPrice } : position,
    ));
  }

  protected applySuggestedShares(): void {
    this.orderDraftEdited = true;
    if (this.suggestedRiskShares() <= 0) { this.orderStatus.set('風險或資金預算不足目前交易單位，請切換零股或調整規劃。'); return; }
    const rawShares = this.suggestedRiskShares();
    const shares = this.shareUnit() === 'boardLot'
      ? Math.floor(rawShares / 1000) * 1000
      : Math.min(rawShares, 999);
    this.positionForm.update((form) => ({ ...form, shares }));
  }

  protected closeTradePosition(position: TradePosition): void {
    this.closeTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.closingPositionId.set(position.id);
    this.closingPrice.set(this.latestPrices()[position.symbol] ?? (position.symbol === this.stockSymbol() ? this.latestPrice() : 0));
    this.closingShares.set(position.shares);
    this.closingDate.set(this.todayInputValue());
    this.closingStatus.set('');
    afterNextRender(() => {
      const dialog = document.getElementById('position-close-dialog') as HTMLDialogElement | null;
      if (dialog && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLInputElement>('input')?.focus(); }
    }, { injector: this.dialogInjector });
  }

  private readonly dialogInjector = inject(Injector);
  private closeTrigger: HTMLElement | null = null;

  protected dismissPositionClose(): void {
    const trigger = this.closeTrigger;
    const dialog = document.getElementById('position-close-dialog') as HTMLDialogElement | null;
    if (dialog?.open) dialog.close();
    this.closingPositionId.set(null);
    afterNextRender(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else document.getElementById('holdings-center')?.focus({ preventScroll: true });
    }, { injector: this.dialogInjector });
    this.closeTrigger = null;
  }

  protected sellPlanProfit(): number | null {
    if (this.orderFormError()) return null;
    const form = this.positionForm();
    return this.sellHoldingProfit({ ...form, id: 'preview', action: 'sell', validDays: this.nearTermDays(), createdAt: '' }, form.entryPrice);
  }

  protected confirmPositionClose(): void {
    const position = this.closingPosition(), preview = this.closingPreview();
    if (!position || !preview) return;
    const shares = this.closingShares();
    const isShort = this.closingIsShort();
    const undoBefore = this.tradeStateJson();
    this.closedTrades.update((trades) => [...trades, {
      ...position, id: `close-${crypto.randomUUID()}`, shares, exitPrice: this.closingPrice(), exitDate: this.closingDate(), realizedProfit: preview.net,
      ...this.tradeCostSnapshot(position.entryPrice, this.closingPrice(), position.type, shares, this.calendarDaysBetween(position.tradeDate, this.closingDate()), position),
    }]);
    this.tradePositions.update(items => items.flatMap(item => item.id !== position.id ? [item] : preview.remaining > 0 ? [this.reducePositionShares(item, shares)] : []));
    this.recordCashTrade(`cash-${crypto.randomUUID()}`, this.closingDate(), this.closingPrice(), shares, true, position.type);
    this.lastTradeUndo.set({ before: undoBefore, after: this.tradeStateJson(), description: `${position.symbol} ${isShort ? '回補' : '平倉'} ${shares} 股` });
    this.confirmUndoTrade.set(false);
    this.undoTradeStatus.set('');
    this.closingStatus.set(`已記錄 ${position.symbol} ${isShort ? '回補' : '平倉'} ${shares} 股，剩餘 ${preview.remaining} 股。`);
    this.dismissPositionClose();
  }

  protected deletePositionGroup(symbol: string): void {
    this.tradePositions.update((positions) => positions.filter((position) => position.symbol !== symbol));
  }

  protected togglePanel(panel: string): void {
    const next = new Set(this.collapsedPanels());
    next.has(panel) ? next.delete(panel) : next.add(panel);
    this.collapsedPanels.set(next);
  }

  protected addTradePosition(): void {
    if (this.orderFormError()) return;
    const form = this.positionForm();
    const symbol = form.symbol.trim();
    const shares = this.normalizedOrderShares(form.shares);
    const entryPrice = form.entryPrice;
    const targetPrice = entryPrice;

    if (!symbol) {
      return;
    }

    const editingId = this.editingPositionId();
    if (editingId) {
      this.tradePositions.update((current) =>
        current.map((position) =>
          position.id === editingId
            ? {
                ...position,
                symbol,
                type: form.type,
                shares,
                entryPrice,
                targetPrice,
                note: form.note.trim(),
                tradeDate: form.tradeDate || position.tradeDate || this.todayInputValue(),
                stopLossPrice: form.stopLossPrice,
              }
            : position,
        ),
      );
    } else {
      this.tradePositions.update((current) => [
        ...current,
        {
          id: `trade-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          symbol,
          type: form.type,
          shares,
          entryPrice,
          targetPrice,
          note: form.note.trim(),
          tradeDate: form.tradeDate || this.todayInputValue(),
          stopLossPrice: form.stopLossPrice,
        },
      ]);
    }

    this.editingPositionId.set(null);
    this.orderStatus.set(editingId ? '已儲存持倉修改。' : `已新增 ${symbol} 持倉 ${shares} 股。`);
    this.positionForm.set({
      symbol,
      type: form.type,
      shares: 1000,
      entryPrice,
      targetPrice,
      note: '',
      tradeDate: this.todayInputValue(),
      stopLossPrice: form.stopLossPrice,
    });
    this.ensureStockQuote(symbol);
  }

  protected addStockRecord(): void {
    const symbol = this.recordSymbolInput().trim();
    if (!/^\d{4,6}$/.test(symbol)) {
      this.recordQuoteError.set('請輸入 4～6 位數字的股票代號，例如 2330 或 6182。');
      return;
    }
    if (this.recordQuoteLoading()) return;
    const existing = this.stockRecords().find(record => record.symbol === symbol);
    if (existing) {
      this.recordSymbolInput.set('');
      this.recordQuoteError.set('');
      this.selectStockRecord(existing);
      return;
    }
    this.recordQuoteLoading.set(symbol);
    this.recordQuoteError.set('');
    this.stockSymbol.set(symbol);
    this.stockName.set('');
    this.editingPositionId.set(null);
    this.syncOrderFormToStock(symbol, 0);
    this.recordSymbolInput.set('');
    this.loadCurrentPrice();
  }

  protected selectStockRecord(record: StockRecord): void {
    this.recordQuoteLoading.set('');
    this.recordQuoteError.set('');
    this.stockSymbol.set(record.symbol);
    this.stockName.set(record.name);
    this.latestPrice.set(record.latestPrice);
    this.selectedPrice.set(record.latestPrice);
    this.editingPositionId.set(null);
    this.syncOrderFormToStock(record.symbol, record.latestPrice);
    const targets = this.tradePositions()
      .filter((position) => position.symbol === record.symbol)
      .map((position) => position.targetPrice)
      .filter((price) => price > 0);
    this.longTermTarget.set(targets.length
      ? targets.reduce((sum, price) => sum + price, 0) / targets.length
      : Math.max(record.latestPrice * 1.1, 1));
    this.loadCurrentPrice();
  }

  protected requestRemoveStockRecord(symbol: string, event: MouseEvent): void {
    event.stopPropagation();
    this.pendingStockRecordDelete.set(symbol);
  }

  protected cancelRemoveStockRecord(event: MouseEvent): void {
    event.stopPropagation();
    this.pendingStockRecordDelete.set(null);
  }

  protected removeStockRecord(symbol: string, event: MouseEvent): void {
    event.stopPropagation();
    const remainingRecords = this.stockRecords().filter((record) => record.symbol !== symbol);
    this.stockRecords.set(remainingRecords);
    this.latestPrices.update((prices) => {
      const { [symbol]: _removed, ...remaining } = prices;
      return remaining;
    });
    this.pendingStockRecordDelete.set(null);

    if (this.stockSymbol() !== symbol) return;
    const nextRecord = remainingRecords[0];
    if (nextRecord) {
      this.selectStockRecord(nextRecord);
      return;
    }

    this.stockSymbol.set('');
    this.stockName.set('');
    this.latestPrice.set(0);
    this.quoteChange.set(0);
    this.quoteDate.set('');
    this.history.set([]);
    this.positionForm.update((form) => ({ ...form, symbol: '' }));
  }

  protected createPresetOrderFromForm(): void {
    if (this.orderFormError() || this.pricePlanningError()) return;
    const form = this.positionForm();
    const symbol = form.symbol.trim();
    if (!symbol) return;
    const action = this.presetOrderAction();
    if (action === 'sell' && !this.canCreateSellPreset()) return;
    const shares = action === 'sell'
      ? Math.min(this.normalizedOrderShares(form.shares), this.sellableFormStockShares())
      : this.normalizedOrderShares(form.shares);
    const editingId = this.editingPresetOrderId();
    const updatedOrder: PresetOrder = {
      id: `preset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      symbol,
      type: form.type,
      action,
      shares,
      entryPrice: Math.max(form.entryPrice, 1),
      exitPrice: form.targetPrice > 0 ? form.targetPrice : undefined,
      validDays: Math.max(this.nearTermDays(), 1),
      createdAt: new Date().toISOString(),
      expiryDate: this.presetExpiryDate(),
      shareUnit: this.shareUnit(),
      stopLossPrice: form.stopLossPrice,
      note: form.note.trim(),
    };
    this.presetOrders.update((orders) => editingId
      ? orders.map((order) => order.id === editingId ? { ...updatedOrder, id: editingId, createdAt: order.createdAt } : order)
      : [...orders, updatedOrder]);
    this.editingPresetOrderId.set(null);
    this.orderStatus.set(editingId ? '已儲存待成交委託修改。' : `已建立 ${symbol} ${action === 'sell' ? '賣出' : '買進'}待成交委託：${shares} 股 × ${form.entryPrice} 元。可修改價格後建立下一筆。`);
  }

  protected createPresetOrder(): void {
    const type = this.orderType();
    const entryPrice = this.selectedPrice();
    const isShort = type === '空單' || type === '融券';
    this.presetOrders.update((orders) => [...orders, {
      id: `preset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      symbol: this.stockSymbol(), type, action: isShort ? 'sell' : 'buy', shares: this.normalizedSimulationShares(), entryPrice,
      exitPrice: isShort ? this.minPrice() : this.maxPrice(),
      validDays: this.nearTermDays(), createdAt: new Date().toISOString(),
      expiryDate: this.presetExpiryDate(),
      shareUnit: this.simulationShareUnit(),
    }]);
  }

  protected removePresetOrder(id: string): void {
    const order = this.presetOrders().find(item => item.id === id);
    if (order) this.archivedPresetOrders.update(items => [...items, { ...order, finalStatus: '取消', finalizedAt: new Date().toISOString() }]);
    this.pendingPresetCancel.set(null);
    this.presetOrders.update((orders) => orders.filter((order) => order.id !== id));
    if (this.editingPresetOrderId() === id) this.editingPresetOrderId.set(null);
    this.orderStatus.set('已取消待成交委託。');
  }

  protected presetProfit(order: PresetOrder): number {
    if (order.action === 'sell') return this.sellHoldingProfit(order, order.entryPrice);
    return this.portfolioCalculator.simulateOrder(
      order.entryPrice, order.exitPrice ?? order.entryPrice, order.type, order.shares, order.validDays,
      this.financingRate(), this.shortBorrowRate(),
    );
  }

  protected removeTradePosition(id: string): void {
    this.tradePositions.update((current) => current.filter((position) => position.id !== id));
    if (this.editingPositionId() === id) {
      this.editingPositionId.set(null);
    }
  }

  protected onBarHoverByDate(date: string, event: MouseEvent): void {
    const point = this.history().find((entry) => entry.date === date);
    if (!point) {
      return;
    }

    this.tooltip.set({
      x: event.offsetX + 12,
      y: event.offsetY + 12,
      date: point.date,
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
      volume: point.volume,
      change: point.change,
    });
  }

  protected onBarLeave(): void {
    this.tooltip.set(null);
  }

  private loadHistory(): void {
    ++this.liveRequestId;
    this.liveLoading.set(false);
    this.liveStatus.set('');
    const requestId = ++this.historyRequestId;
    const symbol = this.stockSymbol();
    const date = this.requestedDate();
    this.historyLoading.set(true);
    this.historyError.set('');
    this.indicatorHistory.set([]);
    this.history.set([]);
    this.stockPriceService.getHistory(symbol, 120, date).subscribe({
      next: (history) => {
        if (requestId !== this.historyRequestId || symbol !== this.stockSymbol() || date !== this.requestedDate()) return;
        this.historyLoading.set(false);
        this.indicatorHistory.set(history);
        this.history.set(history.slice(-this.chartDays()));
        if (this.liveEnabled()) this.refreshIntraday();
        if (!history.length) this.historyError.set('無法取得歷史行情，請檢查資料來源或代理設定。');
      },
      error: (error) => {
        if (requestId !== this.historyRequestId) return;
        this.historyLoading.set(false);
        this.historyError.set(error instanceof Error ? error.message : '歷史行情讀取失敗，請稍後再試。');
      },
    });
  }

  private marketPriceForSymbol(symbol: string): number {
    const cached = this.latestPrices()[symbol];
    if (cached > 0) return cached;
    if (symbol === this.stockSymbol() && this.latestPrice() > 0) return this.latestPrice();
    const positions = this.tradePositions().filter(position => position.symbol === symbol);
    const shares = positions.reduce((sum, position) => sum + position.shares, 0);
    return shares > 0 ? positions.reduce((sum, position) => sum + position.entryPrice * position.shares, 0) / shares : 0;
  }

  private restoreWorkspace(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.workspaceStorageKey);
      this.expectedStoredWorkspace = raw;
      if (!raw) return;
      const saved = validateWorkspaceBackup(raw);
      this.cashMovements.set(saved['cashMovements'] ?? []);
      this.cashOpeningBalance.set(saved['cashOpeningBalance'] ?? 0);
      this.cashTrackingEnabled.set(saved['cashTrackingEnabled'] ?? false);
      const costs = saved['costModel'] as { feeRate: number; minimumFee: number; taxRate: number; financingLoanRatio: number } | undefined;
      this.portfolioCalculator.costSettings.set(costs ?? { feeRate: .001425, minimumFee: 0, taxRate: .003, financingLoanRatio: .4 });
      this.stockIndustries.set(saved['stockIndustries'] && typeof saved['stockIndustries'] === 'object' ? saved['stockIndustries'] as Record<string, string> : {});
      this.priceAlerts.set(saved['priceAlerts'] && typeof saved['priceAlerts'] === 'object' ? saved['priceAlerts'] as Record<string, { lower?: number; upper?: number }> : {});
      const indicators = saved['chartIndicators'] as Record<string, unknown> | undefined;
      if (indicators && typeof indicators === 'object') this.chartIndicators.update(defaults => ({
        obv: typeof indicators['obv'] === 'boolean' ? indicators['obv'] : defaults.obv,
        adl: typeof indicators['adl'] === 'boolean' ? indicators['adl'] : defaults.adl,
        histogram: typeof indicators['histogram'] === 'boolean' ? indicators['histogram'] : defaults.histogram,
      }));
      if (Array.isArray(saved['stockRecords'])) this.stockRecords.set(saved['stockRecords'] as StockRecord[]);
      if (Array.isArray(saved['tradePositions'])) this.tradePositions.set(saved['tradePositions'] as TradePosition[]);
      if (Array.isArray(saved['presetOrders'])) this.presetOrders.set(saved['presetOrders'] as PresetOrder[]);
      if (Array.isArray(saved['closedTrades'])) this.closedTrades.set(saved['closedTrades'] as ClosedTrade[]);
      if (Array.isArray(saved['presetFills'])) this.presetFills.set(saved['presetFills'] as PresetFill[]);
      this.archivedPresetOrders.set(Array.isArray(saved['archivedPresetOrders']) ? saved['archivedPresetOrders'] as Array<PresetOrder & { finalStatus: '已成交' | '取消'; finalizedAt: string }> : []);
      if (saved['latestPrices'] && typeof saved['latestPrices'] === 'object') this.latestPrices.set(saved['latestPrices'] as Record<string, number>);
      if (typeof saved['availableCash'] === 'number') this.availableCash.set(saved['availableCash']);
      if (typeof saved['maxRiskPerTrade'] === 'number') this.maxRiskPerTrade.set(saved['maxRiskPerTrade']);
      if (typeof saved['maxStockWeight'] === 'number') this.maxStockWeight.set(saved['maxStockWeight']);
      if (typeof saved['feeDiscount'] === 'number') this.feeDiscount.set(saved['feeDiscount']);
      this.financingRate.set(typeof saved['financingRate'] === 'number' ? saved['financingRate'] : 4.5);
      this.shortBorrowRate.set(typeof saved['shortBorrowRate'] === 'number' ? saved['shortBorrowRate'] : 3.2);
      const symbol = typeof saved['stockSymbol'] === 'string' ? saved['stockSymbol'].replace(/\D/g, '') : '';
      if (symbol) {
        this.stockSymbol.set(symbol);
        this.stockName.set(typeof saved['stockName'] === 'string' ? saved['stockName'] : symbol);
        const savedPrice = this.latestPrices()[symbol];
        if (savedPrice > 0) {
          this.latestPrice.set(savedPrice);
          this.selectedPrice.set(savedPrice);
          this.syncOrderFormToStock(symbol, savedPrice);
        } else {
          this.positionForm.update((form) => ({ ...form, symbol }));
        }
      }
      this.saveStatus.set('已還原上次儲存的資料');
      const savedAt = new Date(String(saved['savedAt'] ?? ''));
      if (Number.isFinite(savedAt.getTime())) this.saveStatus.set(`已還原資料・上次儲存 ${this.formatSavedTime(savedAt)}（台北）`);
      this.savedWorkspaceContent.set(this.workspaceContent());
    } catch {
      this.autoSaveEnabled.set(false);
      this.saveError.set('無法讀取上次儲存的資料，已暫停自動儲存並保留原紀錄。確認目前資料後，可按「立即儲存」覆寫。');
    }
  }

  private syncOrderFormToStock(symbol: string, marketPrice: number): void {
    this.orderDraftEdited = false;
    this.editedPlanningPrices.clear();
    const price = marketPrice > 0 ? marketPrice : 0;
    const short = this.positionForm().type === '空單' || this.positionForm().type === '融券';
    const existingTargets = this.tradePositions()
      .filter((position) => position.symbol === symbol && position.targetPrice > price && (position.type === '現股多單' || position.type === '融資'))
      .map((position) => position.targetPrice);
    const targetPrice = short ? price * .95 : existingTargets.length
      ? existingTargets.reduce((sum, target) => sum + target, 0) / existingTargets.length
      : price * 1.05;
    this.positionForm.update((form) => ({
      ...form,
      symbol,
      entryPrice: price,
      targetPrice: Math.round(targetPrice * 100) / 100,
      stopLossPrice: price > 0 ? Math.round(price * (short ? 1.05 : .95) * 100) / 100 : undefined,
      note: '',
      tradeDate: this.todayInputValue(),
    }));
  }

  private ensureStockQuote(symbol: string): void {
    if (this.latestPrices()[symbol]) return;
    this.stockPriceService.getLatestQuote(symbol, this.requestedDate()).subscribe((quote) => {
      if (!quote) return;
      this.latestPrices.update((prices) => ({ ...prices, [symbol]: quote.close }));
      this.upsertStockRecord(symbol, quote.name || symbol, quote.close, quote.change, quote.date);
    });
  }

  private upsertStockRecord(symbol: string, name: string, latestPrice: number, change: number, quoteDate: string): void {
    this.stockRecords.update((records) => {
      const knownName = records.find(record => record.symbol === symbol)?.name || (this.stockSymbol() === symbol ? this.stockName() : '');
      const next = { symbol, name: name && name !== symbol ? name : knownName && knownName !== symbol ? knownName : '', latestPrice, change, quoteDate };
      return records.some((record) => record.symbol === symbol)
        ? records.map((record) => record.symbol === symbol ? next : record)
        : [...records, next];
    });
  }

  private priceFromBoardY(y: number): number {
    const top = 40;
    const bottom = 250;
    const clampedY = Math.max(top, Math.min(bottom, y));
    const minPrice = this.boardMinPrice();
    const maxPrice = this.boardMaxPrice();
    const span = Math.max(maxPrice - minPrice, 1);
    return maxPrice - ((clampedY - top) / (bottom - top)) * span;
  }

  private boardMinPrice(): number {
    const values = [...this.currentStockPositions().map((position) => position.entryPrice), ...this.currentStockPresetOrders().map((order) => order.entryPrice)];
    return Math.min(...values, this.minPrice());
  }

  private boardMaxPrice(): number {
    const values = [...this.currentStockPositions().map((position) => position.entryPrice), ...this.currentStockPresetOrders().map((order) => order.entryPrice)];
    return Math.max(...values, this.maxPrice());
  }

  private boardTimeRange(): [number, number] {
    const timestamps = this.currentStockPresetOrders().map((order) => this.presetTimestamp(order));
    const today = new Date().setHours(0, 0, 0, 0);
    const defaultEnd = today + Math.max(this.nearTermDays(), 1) * 24 * 60 * 60 * 1000;
    return [today, Math.max(defaultEnd, ...timestamps)];
  }

  private presetTimestamp(order: PresetOrder): number {
    if (order.expiryDate) return new Date(`${order.expiryDate}T00:00:00`).getTime();
    return new Date(order.createdAt).getTime() + order.validDays * 24 * 60 * 60 * 1000;
  }

  private firstAvailableTradingDate(): string {
    const date = new Date(`${this.todayInputValue()}T00:00:00`);
    while (!isTradingDate(this.toInputDate(date))) date.setDate(date.getDate() + 1);
    return this.toInputDate(date);
  }

  private normalizedOrderShares(shares: number): number {
    return this.shareUnit() === 'boardLot'
      ? Math.max(1000, Math.round(shares / 1000) * 1000)
      : Math.min(Math.max(Math.round(shares), 1), 999);
  }

  private normalizedSimulationShares(): number {
    return this.simulationShareUnit() === 'boardLot'
      ? Math.max(1000, Math.round(this.shares() / 1000) * 1000)
      : Math.min(Math.max(Math.round(this.shares()), 1), 999);
  }

  private addBusinessDays(value: string, days: number): string {
    const date = new Date(`${value}T00:00:00`);
    let remaining = days;
    while (remaining > 0) {
      date.setDate(date.getDate() + 1);
      if (isTradingDate(this.toInputDate(date))) remaining--;
    }
    return this.toInputDate(date);
  }

  private clampPresetDate(value: string): string {
    const candidate = value >= this.presetDateMin && value <= this.presetDateMax ? value : this.presetDateMin;
    const date = new Date(`${candidate}T00:00:00`);
    return !isTradingDate(this.toInputDate(date)) ? this.addBusinessDays(candidate, 1) : candidate;
  }

  private businessDaysThrough(value: string): number {
    let date = new Date(`${this.presetDateMin}T00:00:00`);
    const end = new Date(`${value}T00:00:00`);
    let days = 0;
    while (date <= end) {
      if (isTradingDate(this.toInputDate(date))) days++;
      date.setDate(date.getDate() + 1);
    }
    return Math.max(days, 1);
  }

  private toInputDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private calendarDaysBetween(start: string | undefined, end: string): number {
    if (!start) return 1;
    const duration = new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime();
    return Math.max(Math.round(duration / 86_400_000), 1);
  }

  private sellHoldingProfit(order: PresetOrder, salePrice: number): number {
    const positions = this.tradePositions().filter((position) =>
      position.symbol === order.symbol && position.type === order.type)
      .sort((a, b) => (a.tradeDate ?? '').localeCompare(b.tradeDate ?? ''));
    let remainingShares = order.shares;
    let profit = 0;
    for (const position of positions) {
      if (remainingShares <= 0) break;
      const shares = Math.min(position.shares, remainingShares);
      profit += this.portfolioCalculator.positionProfit(
        position, salePrice, this.feeDiscount(), this.calendarDaysBetween(position.tradeDate, this.todayInputValue()),
        this.financingRate(), this.shortBorrowRate(), shares,
      );
      remainingShares -= shares;
    }
    return profit;
  }
  private buildStockStressScenario(id: string, name: string, assumption: string, shock: number, respectStops: boolean, symbol = this.stockSymbol(), marketPrice = this.valuationPrice()): StressScenario {
    const details: StressScenario['details'] = [];
    const scenarioPrice = marketPrice * (1 + shock);
    const positions = this.tradePositions().filter(position => position.symbol === symbol);
    const stressProfitForPosition = (position: TradePosition, shares: number) => {
      const configuredTarget = position.targetPrice > 0 && position.targetPrice !== position.entryPrice
        ? position.targetPrice : undefined;
      return this.portfolioCalculator.positionProfit(
        position,
        this.scenarioExitPrice(scenarioPrice, position.type, position.stopLossPrice, configuredTarget, respectStops),
        this.feeDiscount(),
        this.calendarDaysBetween(position.tradeDate, this.todayInputValue()),
        this.financingRate(), this.shortBorrowRate(), shares,
      );
    };
    const holdingProfit = positions.reduce((total, position) => total + stressProfitForPosition(position, position.shares), 0);
    for (const position of positions) {
      const target = position.targetPrice !== position.entryPrice ? position.targetPrice : undefined;
      const exit = this.scenarioExitPrice(scenarioPrice, position.type, position.stopLossPrice, target, respectStops);
      const days = this.calendarDaysBetween(position.tradeDate, this.todayInputValue());
      details.push({ label: `持倉 ${position.id} · ${position.type}`, shares: position.shares, entry: position.entryPrice, exit,
        reason: !respectStops ? '跳空：按情境價估值，不假設中間價成交' : exit !== scenarioPrice ? (exit === position.stopLossPrice ? '觸發停損' : '觸發目標') : '按情境價估值',
        costs: this.portfolioCalculator.positionExitCosts(position, exit, position.shares, days, this.financingRate(), this.shortBorrowRate(), this.feeDiscount()).total,
        contribution: stressProfitForPosition(position, position.shares) });
    }
    const remainingShares = new Map(positions.map(position => [position.id,
      this.scenarioTriggersExit(scenarioPrice, position.type, position.stopLossPrice, position.targetPrice !== position.entryPrice ? position.targetPrice : undefined, respectStops) ? 0 : position.shares]));
    let stressedShares = [...remainingShares.values()].reduce((sum, shares) => sum + shares, 0);
    const presetProfit = this.presetOrders().filter(order => order.symbol === symbol && !this.isPresetExpired(order)).reduce((total, order) => {
      if (order.action === 'sell') {
        if (scenarioPrice < order.entryPrice) return total;
        let sharesToSell = order.shares;
        let adjustment = 0;
        for (const position of positions) {
          if (sharesToSell <= 0) break;
          if (position.type !== order.type || (position.type !== '現股多單' && position.type !== '融資')) continue;
          const availableShares = remainingShares.get(position.id) ?? 0;
          const soldShares = Math.min(availableShares, sharesToSell);
          if (soldShares <= 0) continue;
          const holdingDays = this.calendarDaysBetween(position.tradeDate, this.todayInputValue());
          const realizedProfit = this.portfolioCalculator.positionProfit(
            position, order.entryPrice, this.feeDiscount(), holdingDays,
            this.financingRate(), this.shortBorrowRate(), soldShares,
          );
          adjustment += realizedProfit - stressProfitForPosition(position, soldShares);
          details.push({ label: `賣出待成交委託 ${order.id} → ${position.id}`, shares: soldShares, entry: position.entryPrice, exit: order.entryPrice,
            reason: '以委託價賣出：此列為替換上述持倉估值的損益差額，勿重複加總完整損益',
            costs: this.portfolioCalculator.positionExitCosts(position, order.entryPrice, soldShares, holdingDays, this.financingRate(), this.shortBorrowRate(), this.feeDiscount()).total,
            contribution: realizedProfit - stressProfitForPosition(position, soldShares) });
          remainingShares.set(position.id, availableShares - soldShares);
          sharesToSell -= soldShares;
          stressedShares -= soldShares;
        }
        return total + adjustment;
      }
      const remaining = this.scenarioTriggersExit(scenarioPrice, order.type, order.stopLossPrice, order.exitPrice, respectStops) ? 0 : order.shares;
      stressedShares += remaining;
      const exit = this.scenarioExitPrice(scenarioPrice, order.type, order.stopLossPrice, order.exitPrice, respectStops);
      details.push({ label: `進場待成交委託 ${order.id} · ${order.type}`, shares: order.shares, entry: order.entryPrice, exit, remaining,
        reason: '假設全部進場；' + (!respectStops ? '跳空按情境價估值' : exit !== scenarioPrice ? (exit === order.stopLossPrice ? '觸發停損' : '觸發目標') : '按情境價估值'),
        costs: this.portfolioCalculator.tradeCosts(order.entryPrice, exit, order.type, order.shares, order.validDays, this.financingRate(), this.shortBorrowRate(), this.feeDiscount()).total,
        contribution: this.portfolioCalculator.simulateOrder(order.entryPrice, exit, order.type, order.shares, order.validDays, this.financingRate(), this.shortBorrowRate(), this.feeDiscount()) });
      return total + this.portfolioCalculator.simulateOrder(
        order.entryPrice, this.scenarioExitPrice(scenarioPrice, order.type, order.stopLossPrice, order.exitPrice, respectStops), order.type, order.shares, order.validDays,
        this.financingRate(), this.shortBorrowRate(), this.feeDiscount(),
      );
    }, 0);
    const totalProfit = holdingProfit + presetProfit;
    positions.forEach((position, index) => { details[index].remaining = remainingShares.get(position.id) ?? 0; });
    const stressedExposure = scenarioPrice * stressedShares;
    const criticalLoss = Math.max(this.maxRiskPerTrade() * 2, 20_000);
    const severity: StressScenario['severity'] = totalProfit < -criticalLoss
      ? 'critical' : totalProfit < 0 ? 'warning' : 'normal';
    const baseline = positions.reduce((sum, position) => sum + this.portfolioCalculator.positionProfit(position, marketPrice, this.feeDiscount(),
      this.calendarDaysBetween(position.tradeDate, this.todayDate()), this.financingRate(), this.shortBorrowRate()), 0);
    return { id, name, assumption, scenarioPrice, holdingProfit, presetProfit, totalProfit, stressedExposure, severity, details, changeFromNow: totalProfit - baseline };
  }

  private scenarioExitPrice(
    scenarioPrice: number, type: OrderType, stopLossPrice: number | undefined,
    targetPrice: number | undefined, respectStops: boolean,
  ): number {
    if (!respectStops) return scenarioPrice;
    const isShort = type === '空單' || type === '融券';
    if (!isShort && stopLossPrice && scenarioPrice <= stopLossPrice) return stopLossPrice;
    if (isShort && stopLossPrice && scenarioPrice >= stopLossPrice) return stopLossPrice;
    if (!isShort && targetPrice && scenarioPrice >= targetPrice) return targetPrice;
    if (isShort && targetPrice && scenarioPrice <= targetPrice) return targetPrice;
    return scenarioPrice;
  }

  private scenarioTriggersExit(price: number, type: OrderType, stop: number | undefined, target: number | undefined, enabled: boolean): boolean {
    if (!enabled) return false;
    const short = type === '空單' || type === '融券';
    return !!((stop && (short ? price >= stop : price <= stop)) || (target && (short ? price <= target : price >= target)));
  }

  private formatBoardDate(timestamp: number): string {
    return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' }).format(timestamp);
  }

  private colorForBoardType(type: OrderType): string {
    if (type === '空單') {
      return '#38d996';
    }

    if (type === '融資') {
      return '#ff8b8f';
    }

    if (type === '融券') {
      return '#65e0ae';
    }

    return '#ff6268';
  }

  private todayInputValue(): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
  }

  protected onPriceChange(value: number): void {
    const min = this.minPrice();
    const max = this.maxPrice();
    this.selectedPrice.set(Math.min(Math.max(value, min), max));
  }

  protected onLimitUpChange(value: number): void {
    const nextUp = Math.max(value, this.limitDownPrice() + 1);
    this.limitUpPrice.set(nextUp);

    if (this.selectedPrice() > nextUp) {
      this.selectedPrice.set(nextUp);
    }
  }

  protected onLimitDownChange(value: number): void {
    const nextDown = Math.min(Math.max(value, 1), this.limitUpPrice());
    this.limitDownPrice.set(nextDown);

    if (this.selectedPrice() < nextDown) {
      this.selectedPrice.set(nextDown);
    }
  }

  private calculateProfit(entry: number, exit: number, orderType: OrderType, holdingDays: number): number {
    return this.portfolioCalculator.simulateOrder(
      entry, exit, orderType, this.shares(), holdingDays, this.financingRate(), this.shortBorrowRate(),
    );
  }
}
