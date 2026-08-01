import { of } from 'rxjs';

import { StockPriceService } from './stock-price.service';

type Row = [string, string, string, string, string, string, string, string, string, string];

function row(rocDate: string, close = 100): Row {
  return [rocDate, '1,000', '100,000', '99', '102', '98', String(close), '+1', '100', '0'];
}

describe('StockPriceService history', () => {
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
    service.getLatestQuote('6182', '2026-08-01').subscribe((quote) => {
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
