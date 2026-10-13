import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class AlertListSession {
  value: {
    tab: 'new' | 'current' | 'follows';
    category: import('./market-alerts').AlertKind | '全部';
    search: string;
    market: string;
    minTurnover: number;
    sort: string;
    deviationFilter: string;
    limit: number;
    scroll: number;
  } | null = null;
}
