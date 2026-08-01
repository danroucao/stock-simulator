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
      get: (url: string) => url.includes('tpex_mainboard')
        ? of([{ Date:'1150731',SecuritiesCompanyCode:'6182',CompanyName:'合晶',Close:'89.00',Change:'+4.30',Open:'92.90',High:'93.10',Low:'84.00',TradingShares:'27335875',TransactionAmount:'2436625467' }])
        : of({ data: [] }),
    } as any);
    service.getLatestQuote('6182', '2026-08-01').subscribe((quote) => {
      expect(quote?.name).toBe('合晶');
      expect(quote?.close).toBe(89);
      expect(quote?.date).toBe('115/07/31');
    });
  });

  it('loads and sorts a complete TPEx history range when TWSE has no rows', () => {
    const service = new StockPriceService({
      get: (url: string) => url.includes('afterTrading/tradingStock')
        ? of({ name: '合晶', tables: [{ data: [
          ['115/07/31', '27,336', '2,436,625', '92.90', '93.10', '84.00', '89.00', '4.30', '20,196'],
          ['115/07/30', '22,524', '1,909,209', '84.70', '86.70', '84.70', '84.70', '-9.40', '17,910'],
        ] }] })
        : of({ data: [] }),
    } as any);

    service.getHistory('6182', 20, '2026-08-01').subscribe((history) => {
      expect(history.map((point) => point.date)).toEqual(['115/07/30', '115/07/31']);
      expect(history.at(-1)?.close).toBe(89);
      expect(history.at(-1)?.volume).toBe(27_336_000);
    });
  });
});
