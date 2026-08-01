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

  it('should create a near-term preset order from the unified order board', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    (compiled.querySelector('.order-mode-switch button:nth-child(2)') as HTMLButtonElement).click();
    fixture.detectChanges();
    const button = compiled.querySelector('.form-submit') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.preset-order-row')?.textContent).toContain('待觸發');
    expect(compiled.querySelectorAll('.preset-marker').length).toBe(1);
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
    expect(compiled.querySelector('.board-form')?.textContent).not.toContain('預測出場價');
    const presetMode = Array.from(compiled.querySelectorAll('.order-mode-switch button')).find((button) => button.textContent?.includes('建立近期預設單')) as HTMLButtonElement;
    presetMode.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.board-form')?.textContent).toContain('預測出場價');
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
