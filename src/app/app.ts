import { DecimalPipe } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

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
}

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, PositionDetails],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly workspaceStorageKey = 'stock-simulator-workspace-v1';
  protected readonly title = signal('Stock Trading Simulator');
  protected readonly stockSymbol = signal('2330');
  protected readonly stockName = signal('台積電');
  protected readonly recordSymbolInput = signal('');
  protected readonly stockRecords = signal<StockRecord[]>([]);
  protected readonly latestPrices = signal<Record<string, number>>({});
  protected readonly recordQuoteLoading = signal('');
  protected readonly recordQuoteError = signal('');
  protected readonly requestedDate = signal(this.todayInputValue());
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
  protected readonly quoteChange = signal(0);
  protected readonly latestPrice = signal(0);
  protected readonly turnover = signal(0);
  protected readonly isLoadingQuote = signal(false);
  protected readonly quoteError = signal('');
  protected readonly history = signal<StockHistoryPoint[]>([]);
  protected readonly tooltip = signal<ChartTooltip | null>(null);
  protected readonly boardTooltip = signal<BoardTooltipState | null>(null);
  protected readonly draggingBoardMarker = signal<string | null>(null);
  protected readonly editingPositionId = signal<string | null>(null);
  protected readonly orderEntryMode = signal<'holding' | 'preset'>('holding');
  protected readonly presetOrderAction = signal<PresetOrderAction>('buy');
  protected readonly shareUnit = signal<'boardLot' | 'oddLot'>('boardLot');
  protected readonly simulationShareUnit = signal<'boardLot' | 'oddLot'>('boardLot');
  protected readonly collapsedPanels = signal<Set<string>>(new Set());
  protected readonly saveStatus = signal('');
  protected readonly holdingViewMode = signal<'current' | 'all'>('all');
  protected readonly nearTermDays = signal(5);
  protected readonly presetExpiryDate = signal(this.addBusinessDays(this.firstAvailableTradingDate(), 4));
  protected readonly presetDateMin = this.firstAvailableTradingDate();
  protected readonly presetDateMax = this.addBusinessDays(this.firstAvailableTradingDate(), 4);
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
      (total, position) => total + this.portfolioCalculator.positionProfit(position, this.valuationPrice(), this.feeDiscount()),
      0,
    ),
  );

  protected readonly portfolioMarketValue = computed(() => this.tradePositions().reduce(
    (total, position) => total + this.portfolioCalculator.positionMarketValue(position, this.marketPriceForSymbol(position.symbol)), 0,
  ));

  protected readonly portfolioCost = computed(() => this.tradePositions().reduce(
    (total, position) => total + this.portfolioCalculator.positionCost(position), 0,
  ));

  protected readonly portfolioUnrealizedProfit = computed(() => this.tradePositions().reduce(
    (total, position) => total + this.portfolioCalculator.positionProfit(position, this.marketPriceForSymbol(position.symbol), this.feeDiscount()), 0,
  ));

  protected readonly portfolioRealizedProfit = computed(() => this.closedTrades().reduce(
    (total, trade) => total + trade.realizedProfit, 0,
  ));

  protected readonly pendingOrderCapital = computed(() => this.presetOrders().reduce(
    (total, order) => total + (order.action === 'sell' ? 0 : order.entryPrice * order.shares), 0,
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
  protected readonly suggestedRiskShares = computed(() => {
    const stopLoss = this.proposedStopLoss();
    return stopLoss === undefined ? 0 : this.portfolioCalculator.recommendedShares(
      this.positionForm().entryPrice, stopLoss, this.maxRiskPerTrade(), this.feeDiscount(),
    );
  });
  protected readonly proposedOrderRisk = computed(() => {
    const stopLoss = this.proposedStopLoss();
    return stopLoss === undefined ? 0 : Math.abs(this.portfolioCalculator.simulateOrder(
      this.positionForm().entryPrice, stopLoss, this.positionForm().type, this.positionForm().shares, 1,
      this.financingRate(), this.shortBorrowRate(), this.feeDiscount(),
    ));
  });
  protected readonly proposedOrderReward = computed(() => {
    const targetPrice = this.positionForm().targetPrice;
    return targetPrice > 0 ? Math.max(this.portfolioCalculator.simulateOrder(
      this.positionForm().entryPrice, targetPrice, this.positionForm().type, this.positionForm().shares,
      this.nearTermDays(), this.financingRate(), this.shortBorrowRate(), this.feeDiscount(),
    ), 0) : 0;
  });  protected readonly proposedRiskRewardRatio = computed(() => this.proposedOrderRisk() > 0
    ? this.proposedOrderReward() / this.proposedOrderRisk() : 0);

  protected readonly backtestResult = computed<BacktestResult>(() => this.portfolioCalculator.backtest(
    this.history().map((point) => point.close), this.positionForm().type, 100_000,
  ));

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
      const profit = this.portfolioCalculator.positionProfit(position, this.marketPriceForSymbol(position.symbol), this.feeDiscount());
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
    return points[points.length - 1] ?? null;
  });

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
    this.loadCurrentPrice();
  }

  protected saveWorkspace(): void {
    if (typeof localStorage === 'undefined') return;
    const snapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      stockSymbol: this.stockSymbol(),
      stockName: this.stockName(),
      stockRecords: this.stockRecords(),
      latestPrices: this.latestPrices(),
      tradePositions: this.tradePositions(),
      presetOrders: this.presetOrders(),
      closedTrades: this.closedTrades(),
      availableCash: this.availableCash(),
      maxRiskPerTrade: this.maxRiskPerTrade(),
      maxStockWeight: this.maxStockWeight(),
      feeDiscount: this.feeDiscount(),
    };
    localStorage.setItem(this.workspaceStorageKey, JSON.stringify(snapshot));
    this.saveStatus.set(`已儲存 ${new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())}`);
  }

  protected loadCurrentPrice(): void {
    const requestedSymbol = this.stockSymbol();
    this.isLoadingQuote.set(true);
    this.quoteError.set('');

    this.stockPriceService.getLatestQuote(requestedSymbol, this.requestedDate()).subscribe({
      next: (quote) => {
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
        this.quoteChange.set(quote.change);
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
        this.stockName.set(quote.name || requestedSymbol);
        this.quoteError.set('');

        if (this.stockSymbol() === requestedSymbol && !this.editingPositionId()) {
          this.syncOrderFormToStock(requestedSymbol, quote.close);
        }

        this.loadHistory();
      },
      error: () => {
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
    this.requestedDate.set(value || this.todayInputValue());
    this.loadHistory();
  }

  protected onChartRangeChange(days: number): void {
    this.chartDays.set(days);
    this.loadHistory();
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

  protected editTradePosition(position: TradePosition): void {
    this.orderEntryMode.set('holding');
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
    this.positionForm.update((current) => ({ ...current, [field]: value }));
  }

  protected onPresetOrderActionChange(value: PresetOrderAction): void {
    this.presetOrderAction.set(value);
    this.positionForm.update((form) => ({ ...form, type: value === 'sell' ? '空單' : '現股多單' }));
  }

  protected onShareUnitChange(value: 'boardLot' | 'oddLot'): void {
    this.shareUnit.set(value);
    this.positionForm.update((form) => ({
      ...form,
      shares: value === 'boardLot'
        ? Math.max(1000, Math.round(form.shares / 1000) * 1000)
        : Math.min(Math.max(form.shares, 1), 999),
    }));
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
    const rawShares = this.suggestedRiskShares();
    const shares = this.shareUnit() === 'boardLot'
      ? Math.floor(rawShares / 1000) * 1000
      : Math.min(rawShares, 999);
    this.positionForm.update((form) => ({ ...form, shares: Math.max(shares, this.shareUnit() === 'boardLot' ? 1000 : 1) }));
  }

  protected closeTradePosition(position: TradePosition): void {
    const exitPrice = this.marketPriceForSymbol(position.symbol);
    const holdingDays = this.calendarDaysBetween(position.tradeDate, this.todayInputValue());
    const realizedProfit = this.portfolioCalculator.simulateOrder(
      position.entryPrice, exitPrice, position.type, position.shares, holdingDays,
      this.financingRate(), this.shortBorrowRate(), this.feeDiscount(),
    );
    this.closedTrades.update((trades) => [...trades, {
      ...position, exitPrice, exitDate: this.todayInputValue(), realizedProfit,
    }]);
    this.removeTradePosition(position.id);
  }

  protected togglePanel(panel: string): void {
    const next = new Set(this.collapsedPanels());
    next.has(panel) ? next.delete(panel) : next.add(panel);
    this.collapsedPanels.set(next);
  }

  protected addTradePosition(): void {
    const form = this.positionForm();
    const symbol = form.symbol.trim();
    const shares = this.normalizedOrderShares(form.shares);
    const entryPrice = Math.max(form.entryPrice, 1);
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
    const symbol = this.recordSymbolInput().replace(/\D/g, '');
    if (!symbol) return;
    this.recordQuoteLoading.set(symbol);
    this.recordQuoteError.set('');
    this.stockSymbol.set(symbol);
    this.editingPositionId.set(null);
    this.positionForm.update((form) => ({ ...form, symbol }));
    this.recordSymbolInput.set('');
    this.loadCurrentPrice();
  }

  protected selectStockRecord(record: StockRecord): void {
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

  protected removeStockRecord(symbol: string, event: MouseEvent): void {
    event.stopPropagation();
    this.stockRecords.update((records) => records.filter((record) => record.symbol !== symbol));
  }

  protected createPresetOrderFromForm(): void {
    const form = this.positionForm();
    const symbol = form.symbol.trim();
    if (!symbol) return;
    this.presetOrders.update((orders) => [...orders, {
      id: `preset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      symbol,
      type: form.type,
      action: this.presetOrderAction(),
      shares: this.normalizedOrderShares(form.shares),
      entryPrice: Math.max(form.entryPrice, 1),
      exitPrice: form.targetPrice > 0 ? form.targetPrice : undefined,
      validDays: Math.max(this.nearTermDays(), 1),
      createdAt: new Date().toISOString(),
      expiryDate: this.presetExpiryDate(),
      shareUnit: this.shareUnit(),
      stopLossPrice: form.stopLossPrice,
    }]);
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
    this.presetOrders.update((orders) => orders.filter((order) => order.id !== id));
  }

  protected presetProfit(order: PresetOrder): number {
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
    this.stockPriceService.getHistory(this.stockSymbol(), this.chartDays(), this.requestedDate()).subscribe({
      next: (history) => {
        this.history.set(history);
      },
      error: () => {
        this.history.set([]);
      },
    });
  }

  private marketPriceForSymbol(symbol: string): number {
    return this.latestPrices()[symbol] ?? (symbol === this.stockSymbol() ? this.valuationPrice() : this.selectedPrice());
  }

  private restoreWorkspace(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.workspaceStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(saved['stockRecords'])) this.stockRecords.set(saved['stockRecords'] as StockRecord[]);
      if (Array.isArray(saved['tradePositions'])) this.tradePositions.set(saved['tradePositions'] as TradePosition[]);
      if (Array.isArray(saved['presetOrders'])) this.presetOrders.set(saved['presetOrders'] as PresetOrder[]);
      if (Array.isArray(saved['closedTrades'])) this.closedTrades.set(saved['closedTrades'] as ClosedTrade[]);
      if (saved['latestPrices'] && typeof saved['latestPrices'] === 'object') this.latestPrices.set(saved['latestPrices'] as Record<string, number>);
      if (typeof saved['availableCash'] === 'number') this.availableCash.set(saved['availableCash']);
      if (typeof saved['maxRiskPerTrade'] === 'number') this.maxRiskPerTrade.set(saved['maxRiskPerTrade']);
      if (typeof saved['maxStockWeight'] === 'number') this.maxStockWeight.set(saved['maxStockWeight']);
      if (typeof saved['feeDiscount'] === 'number') this.feeDiscount.set(saved['feeDiscount']);
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
    } catch {
      localStorage.removeItem(this.workspaceStorageKey);
      this.saveStatus.set('儲存資料已損壞，已改用預設資料');
    }
  }

  private syncOrderFormToStock(symbol: string, marketPrice: number): void {
    const price = Math.max(marketPrice, 1);
    const existingTargets = this.tradePositions()
      .filter((position) => position.symbol === symbol && position.targetPrice > 0)
      .map((position) => position.targetPrice);
    const targetPrice = existingTargets.length
      ? existingTargets.reduce((sum, target) => sum + target, 0) / existingTargets.length
      : price * 1.05;
    this.positionForm.update((form) => ({
      ...form,
      symbol,
      entryPrice: price,
      targetPrice: Math.round(targetPrice * 100) / 100,
      stopLossPrice: Math.round(price * 0.95 * 100) / 100,
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
      const next = { symbol, name, latestPrice, change, quoteDate };
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
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
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
      if (date.getDay() !== 0 && date.getDay() !== 6) remaining--;
    }
    return this.toInputDate(date);
  }

  private clampPresetDate(value: string): string {
    const candidate = value >= this.presetDateMin && value <= this.presetDateMax ? value : this.presetDateMin;
    const date = new Date(`${candidate}T00:00:00`);
    return date.getDay() === 0 || date.getDay() === 6 ? this.addBusinessDays(candidate, 1) : candidate;
  }

  private businessDaysThrough(value: string): number {
    let date = new Date(`${this.presetDateMin}T00:00:00`);
    const end = new Date(`${value}T00:00:00`);
    let days = 0;
    while (date <= end) {
      if (date.getDay() !== 0 && date.getDay() !== 6) days++;
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

  private buildStockStressScenario(id: string, name: string, assumption: string, shock: number, respectStops: boolean): StressScenario {
    const scenarioPrice = this.valuationPrice() * (1 + shock);
    const holdingProfit = this.currentStockPositions().reduce((total, position) => {
      const configuredTarget = position.targetPrice > 0 && position.targetPrice !== position.entryPrice
        ? position.targetPrice : undefined;
      return total + this.portfolioCalculator.simulateOrder(
        position.entryPrice,
        this.scenarioExitPrice(scenarioPrice, position.type, position.stopLossPrice, configuredTarget, respectStops),
        position.type, position.shares,
        this.calendarDaysBetween(position.tradeDate, this.todayInputValue()),
        this.financingRate(), this.shortBorrowRate(), this.feeDiscount(),
      );
    }, 0);
    const presetProfit = this.currentStockPresetOrders().reduce((total, order) => total + this.portfolioCalculator.simulateOrder(
      order.entryPrice, this.scenarioExitPrice(scenarioPrice, order.type, order.stopLossPrice, order.exitPrice, respectStops), order.type, order.shares, order.validDays,
      this.financingRate(), this.shortBorrowRate(), this.feeDiscount(),
    ), 0);
    const totalProfit = holdingProfit + presetProfit;
    const stressedExposure = scenarioPrice * (
      this.currentStockHoldingShares() + this.currentStockPresetOrders().reduce((sum, order) => sum + order.shares, 0)
    );
    const criticalLoss = Math.max(this.maxRiskPerTrade() * 2, 20_000);
    const severity: StressScenario['severity'] = totalProfit < -criticalLoss
      ? 'critical' : totalProfit < 0 ? 'warning' : 'normal';
    return { id, name, assumption, scenarioPrice, holdingProfit, presetProfit, totalProfit, stressedExposure, severity };
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

  private formatBoardDate(timestamp: number): string {
    return new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit' }).format(timestamp);
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
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
