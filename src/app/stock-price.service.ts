import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';

interface TwseStockResponse {
  data?: [string, string, string, string, string, string, string, string, string, string][];
  stat?: string;
  title?: string;
}

interface FinMindHistoryResponse {
  data?: Array<{
    date: string;
    stock_id: string;
    Trading_Volume: number;
    Trading_money: number;
    open: number;
    max: number;
    min: number;
    close: number;
    spread: number;
  }>;
}

interface MisQuoteResponse {
  msgArray?: Array<{
    c?: string;
    n?: string;
    d?: string;
    z?: string;
    o?: string;
    h?: string;
    l?: string;
    y?: string;
    v?: string;
  }>;
}

export interface StockQuote {
  date: string;
  name: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  turnover: number;
  volume: number;
}

export interface StockHistoryPoint extends StockQuote {}

@Injectable({ providedIn: 'root' })
export class StockPriceService {
  private readonly requestUrl = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY';
  private readonly tpexProxyUrl = this.getTpexProxyUrl();
  constructor(private readonly http: HttpClient) {}

  getLatestQuote(symbol: string, requestDate?: string): Observable<StockQuote | null> {
    const normalizedSymbol = symbol.replace(/\D/g, '');
    if (!normalizedSymbol) {
      return of(null);
    }

    const normalizedDate = this.buildRequestDate(requestDate);

    return this.http
      .get<TwseStockResponse>(`${this.requestUrl}?response=json&date=${normalizedDate}&stockNo=${normalizedSymbol}`)
      .pipe(
        map((response) => this.mapQuote(response, requestDate)),
        catchError(() => of(null)),
        switchMap((quote) => quote ? of(quote) : this.getTpexLatestQuote(normalizedSymbol)),
      );
  }

  getHistory(symbol: string, days = 30, requestDate?: string): Observable<StockHistoryPoint[]> {
    const normalizedSymbol = symbol.replace(/\D/g, '');
    if (!normalizedSymbol) {
      return of([]);
    }

    const requests = this.buildHistoryRequestDates(requestDate, days).map((date) =>
      this.http
        .get<TwseStockResponse>(`${this.requestUrl}?response=json&date=${date}&stockNo=${normalizedSymbol}`)
        .pipe(catchError(() => of({ data: [] } as TwseStockResponse))),
    );

    return forkJoin(requests).pipe(
      map((responses) => this.mapHistory(responses, days, requestDate)),
      switchMap((history) => history.length
        ? of(history)
        : this.getTpexHistory(normalizedSymbol, days, requestDate)),
    );
  }

  private getTpexHistory(symbol: string, days: number, requestDate?: string): Observable<StockHistoryPoint[]> {
    const rawTarget = requestDate?.trim() ? new Date(`${requestDate}T00:00:00`) : new Date();
    const target = Number.isNaN(rawTarget.getTime()) ? new Date() : rawTarget;
    const start = new Date(target);
    start.setDate(start.getDate() - Math.max(days * 2, 45));
    const formatDate = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    return this.http.get<FinMindHistoryResponse>(
      `${this.tpexProxyUrl}/api/history?symbol=${symbol}&start_date=${formatDate(start)}&end_date=${formatDate(target)}`,
    ).pipe(
      map((response) => (response.data ?? [])
        .filter((row) => row.stock_id === symbol)
        .map((row) => {
          const [year, month, day] = row.date.split('-').map(Number);
          return {
            date: `${year - 1911}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
            name: symbol,
            open: row.open,
            high: row.max,
            low: row.min,
            close: row.close,
            change: row.spread,
            turnover: row.Trading_money,
            volume: row.Trading_Volume,
          };
        })
        .sort((left, right) => this.dateKey(left.date) - this.dateKey(right.date))
        .slice(-Math.max(days, 1))),
      catchError(() => of([])),
    );
  }
  private getTpexLatestQuote(symbol: string): Observable<StockQuote | null> {
    return this.http.get<MisQuoteResponse>(`${this.tpexProxyUrl}/api/quote?symbol=${symbol}`).pipe(
      map((response) => {
        const row = response.msgArray?.find((item) => item.c === symbol);
        if (!row) return null;
        const previousClose = this.toNumber(row.y ?? '0');
        const close = this.toNumber(row.z ?? row.y ?? '0');
        return {
          date: row.d || '',
          name: row.n?.trim() || symbol,
          open: this.toNumber(row.o ?? '0'),
          high: this.toNumber(row.h ?? '0'),
          low: this.toNumber(row.l ?? '0'),
          close,
          change: close - previousClose,
          turnover: 0,
          volume: this.toNumber(row.v ?? '0') * 1000,
        };
      }),
      catchError(() => of(null)),
    );
  }

  private getTpexProxyUrl(): string {
    const configuredUrl = (globalThis as typeof globalThis & {
      __STOCK_APP_CONFIG__?: { tpexProxyUrl?: string };
    }).__STOCK_APP_CONFIG__?.tpexProxyUrl?.trim();
    return (configuredUrl || '/api/tpex').replace(/\/$/, '');
  }

  private mapQuote(response: TwseStockResponse, requestDate?: string): StockQuote | null {
    const series = (response?.data ?? [])
      .map((entry) => (entry.length >= 8 ? this.toStockEntry(entry, response.title) : null))
      .filter((entry): entry is StockHistoryPoint => entry !== null)
      .sort((left, right) => this.dateKey(left.date) - this.dateKey(right.date));

    const targetDate = this.normalizeLookupDate(requestDate);
    const exactMatch = targetDate ? series.find((entry) => entry.date === targetDate) : undefined;
    const selected = exactMatch ?? series.at(-1);

    return selected ?? null;
  }

  private mapHistory(responses: TwseStockResponse[], days: number, requestDate?: string): StockHistoryPoint[] {
    const byDate = new Map<string, StockHistoryPoint>();
    for (const response of responses) {
      for (const entry of response?.data ?? []) {
        if (entry.length >= 8) {
          const point = this.toStockEntry(entry, response.title);
          byDate.set(point.date, point);
        }
      }
    }

    const targetDate = this.normalizeLookupDate(requestDate);
    const targetKey = targetDate ? this.dateKey(targetDate) : Number.POSITIVE_INFINITY;
    return Array.from(byDate.values())
      .filter((point) => this.dateKey(point.date) <= targetKey)
      .sort((left, right) => this.dateKey(left.date) - this.dateKey(right.date))
      .slice(-Math.max(days, 1));
  }

  private buildHistoryRequestDates(requestDate: string | undefined, days: number): string[] {
    const rawDate = requestDate?.trim() ? new Date(`${requestDate}T00:00:00`) : new Date();
    const target = Number.isNaN(rawDate.getTime()) ? new Date() : rawDate;
    const monthCount = Math.max(1, Math.ceil(Math.max(days, 1) / 18) + 1);
    return Array.from({ length: monthCount }, (_, index) => {
      const month = new Date(target.getFullYear(), target.getMonth() - index, 1);
      return `${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, '0')}01`;
    });
  }

  private dateKey(date: string): number {
    const [rocYear = '0', month = '0', day = '0'] = date.trim().split('/');
    return (Number(rocYear) + 1911) * 10000 + Number(month) * 100 + Number(day);
  }

  private toStockEntry(
    entry: [string, string, string, string, string, string, string, string, string, string],
    title?: string,
  ): StockHistoryPoint {
    const [date, volume, turnover, open, high, low, close, change] = entry;

    return {
      date: date.trim(),
      name: this.extractStockName(title),
      open: this.toNumber(open),
      high: this.toNumber(high),
      low: this.toNumber(low),
      close: this.toNumber(close),
      change: this.toNumber(change),
      turnover: this.toNumber(turnover),
      volume: this.toNumber(volume),
    };
  }

  private buildRequestDate(requestDate?: string): string {
    const targetDate = requestDate?.trim() ? new Date(`${requestDate}T00:00:00`) : new Date();

    if (Number.isNaN(targetDate.getTime())) {
      return this.defaultTradingDate();
    }

    while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
      targetDate.setDate(targetDate.getDate() - 1);
    }

    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');

    return `${y}${m}${d}`;
  }

  private normalizeLookupDate(requestDate?: string): string {
    if (!requestDate?.trim()) {
      return '';
    }

    const parsed = new Date(`${requestDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    const rocYear = parsed.getFullYear() - 1911;
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');

    return `${rocYear}/${month}/${day}`;
  }

  private defaultTradingDate(): string {
    const now = new Date();
    const localDate = new Date(now.getTime());

    while (localDate.getDay() === 0 || localDate.getDay() === 6) {
      localDate.setDate(localDate.getDate() - 1);
    }

    const y = localDate.getFullYear();
    const m = String(localDate.getMonth() + 1).padStart(2, '0');
    const d = String(localDate.getDate()).padStart(2, '0');

    return `${y}${m}${d}`;
  }

  private extractStockName(title?: string): string {
    if (!title) {
      return '';
    }

    const normalizedTitle = title
      .split('：')
      .at(-1)
      ?.trim();

    const cleaned = (normalizedTitle || title)
      .replace(/^\d+年\d+月\s*/, '')
      .replace(/\s*各日成交資訊$/, '')
      .trim();

    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      return tokens.slice(1).join(' ');
    }

    return cleaned || title.trim();
  }

  private toNumber(value: string): number {
    const cleaned = value.replace(/,/g, '').trim();
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
