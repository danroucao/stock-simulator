import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { App } from './app';
import { StockPriceService } from './stock-price.service';

describe('App', () => {
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
    expect(compiled.querySelector('#position-detail-title')?.textContent).toContain('持倉筆記與實際盈虧');
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
    const presetMode = Array.from(compiled.querySelectorAll('.order-mode-switch button')).find((button) => button.textContent?.includes('建立近期預設單')) as HTMLButtonElement;
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
});
