import { of } from 'rxjs';

import { StockPriceService } from './stock-price.service';

type Row = [string, string, string, string, string, string, string, string, string, string];

function row(rocDate: string, close = 100): Row {
  return [rocDate, '1,000', '100,000', '99', '102', '98', String(close), '+1', '100', '0'];
}

describe('StockPriceService history', () => {
  it('uses MIS quotes for an explicit Taipei today query without waiting for history', () => {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const urls: string[] = [];
    const service = new StockPriceService({ get: (url: string) => {
      urls.push(url);
      return of({ msgArray: [{ c: '6182', n: '合晶', d: today.replaceAll('-', ''), z: '129', y: '135', o: '132', h: '133', l: '125.5', v: '59848' }] });
    } } as any);
    service.getLatestQuote('6182', today).subscribe(quote => {
      expect(quote?.close).toBe(129);
      expect(quote?.name).toBe('合晶');
    });
    expect(urls.length).toBe(1);
    expect(urls[0]).toContain('/api/quote');
  });
  it('never selects a TWSE price later than the requested historical date', () => {
    const service = new StockPriceService({ get: () => of({}) } as any);
    const quote = (service as any).mapQuote({ data: [row('115/10/05', 100), row('115/10/08', 120)] }, '2026-10-06');
    expect(quote.close).toBe(100);
    expect((service as any).mapQuote({ data: [row('115/10/08')] }, '2026-10-06')).toBeNull();
  });

  it('never falls back to a current quote for a missing historical date', () => {
    const urls: string[] = [];
    const service = new StockPriceService({ get: (url: string) => { urls.push(url); return of({ data: [] }); } } as any);
    service.getLatestQuote('6182', '2026-10-01').subscribe(quote => expect(quote).toBeNull());
    expect(urls.some(url => url.includes('/api/quote'))).toBe(false);
  });
  it('rejects missing intraday prices instead of using the previous close', () => {
    const service = new StockPriceService({ get: () => of({ msgArray: [{ c: '2330', d: '20261008', z: '-', y: '100', o: '100', h: '102', l: '99', v: '10' }] }) } as any);
    service.getIntradayQuote('2330').subscribe(quote => expect(quote).toBeNull());
  });

  it('retains source time and converts cumulative quote volume to shares', () => {
    const service = new StockPriceService({ get: () => of({ msgArray: [{ c: '2330', d: '20261008', t: '10:30:00', z: '101', y: '100', o: '100', h: '102', l: '99', v: '10' }] }) } as any);
    service.getIntradayQuote('2330').subscribe(quote => {
      expect(quote?.volume).toBe(10000);
      expect(quote?.quoteTime).toBe('10:30:00');
      expect(quote?.change).toBe(1);
    });
  });
  it('merges months, sorts old-to-new and returns the requested trading-day count', () => {
    const service = new StockPriceService({ get: () => of({ data: [] }) } as any);
    const responses = [
      { data: Array.from({ length: 22 }, (_, index) => row(`115/03/${String(index + 1).padStart(2, '0')}`)) },
      { data: Array.from({ length: 22 }, (_, index) => row(`115/02/${String(index + 1).padStart(2, '0')}`)) },
      { data: Array.from({ length: 22 }, (_, index) => row(`115/01/${String(index + 1).padStart(2, '0')}`)) },
    ];
    const history = (service as any).mapHistory(responses, 60, '2026-03-22');
    expect(history.length).toBe(60);
    expect(history[0].date).toBe('115/01/07');
    expect(history.at(-1).date).toBe('115/03/22');
  });

  it('requests enough calendar months for a 60-day range', () => {
    const requestedUrls: string[] = [];
    const service = new StockPriceService({
      get: (url: string) => { requestedUrls.push(url); return of({ data: [] }); },
    } as any);
    service.getHistory('2330', 60, '2026-08-01').subscribe();
    const twseRequests = requestedUrls.filter((url) => url.includes('STOCK_DAY'));
    expect(twseRequests.length).toBe(5);
    expect(twseRequests[0]).toContain('date=20260801');
    expect(twseRequests.at(-1)).toContain('date=20260401');
  });

  it('falls back to TPEx quotes when a symbol is not listed on TWSE', () => {
    const service = new StockPriceService({
      get: (url: string) => url.includes('/api/quote')
        ? of({ msgArray: [{ c:'6182',n:'合晶',d:'20260731',z:'89.00',y:'84.70',o:'92.90',h:'93.10',l:'84.00',v:'27336' }] })
        : of({ data: [] }),
    } as any);
    service.getLatestQuote('6182').subscribe((quote) => {
      expect(quote?.name).toBe('合晶');
      expect(quote?.close).toBe(89);
      expect(quote?.date).toBe('20260731');
    });
  });

  it('loads and sorts a complete OTC history range when TWSE has no rows', () => {
    const service = new StockPriceService({
      get: (url: string) => url.includes('/api/history')
        ? of({ data: [
          { date:'2026-07-31',stock_id:'6182',Trading_Volume:27335875,Trading_money:2436625467,open:92.9,max:93.1,min:84,close:89,spread:4.3 },
          { date:'2026-07-30',stock_id:'6182',Trading_Volume:22523675,Trading_money:1909209346,open:84.7,max:86.7,min:84.7,close:84.7,spread:-9.4 },
        ] })
        : of({ data: [] }),
    } as any);

    service.getHistory('6182', 20, '2026-08-01').subscribe((history) => {
      expect(history.map((point) => point.date)).toEqual(['115/07/30', '115/07/31']);
      expect(history.at(-1)?.close).toBe(89);
      expect(history.at(-1)?.volume).toBe(27_335_875);
    });
  });});
