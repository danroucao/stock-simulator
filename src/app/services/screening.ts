import type { AnalysisStock, MetricKey } from './market-analysis';
export interface ScreenFilter {
  query: string;
  market: string;
  industry: string;
  consolidation: string;
  direction: string;
  state: string;
  bounds: Partial<Record<MetricKey, { min?: number; max?: number }>>;
  sort: MetricKey;
  descending: boolean;
}
export const defaultFilter = (): ScreenFilter => ({
  query: '',
  market: 'all',
  industry: 'all',
  consolidation: 'all',
  direction: 'all',
  state: 'all',
  bounds: {},
  sort: 'turnover',
  descending: true,
});
// URL owns the complete view when present. Old industry-only links remain compatible.
export function filterFromQuery(query: Record<string, string>, fallback: ScreenFilter): ScreenFilter {
  if (query['filter']) {
    try {
      const value = JSON.parse(query['filter']);
      const base = defaultFilter();
      if (!value || !Object.keys(base).every(key => key in value) ||
        !['all','twse','tpex'].includes(value.market) || typeof value.industry !== 'string' ||
        typeof value.query !== 'string' || !['all','yes','no'].includes(value.consolidation) ||
        !['all','上升','下降','平穩','未知'].includes(value.direction) ||
        !['all','區間內','整理中','突破待確認','跌破區間','回到原區間','今日突破','今日跌破'].includes(value.state) ||
        typeof value.descending !== 'boolean' || !value.bounds || typeof value.bounds!=='object' || Array.isArray(value.bounds) ||
        !['close','change','volume','turnover','width','trend','sma5','sma60','deviation','smaChange','volatility','averageTurnover','zeroDays','distance'].includes(value.sort) ||
        Object.entries(value.bounds).some(([key,b])=>!['width','distance','volatility','deviation','averageTurnover'].includes(key) || !b || typeof b!=='object' || Object.entries(b).some(([side,n])=>!['min','max'].includes(side)||typeof n!=='number'||!Number.isFinite(n)))) return defaultFilter();
      return value;
    } catch { return defaultFilter(); }
  }
  return query['industry'] ? { ...defaultFilter(), industry: query['industry'] } : structuredClone(fallback);
}

export function technicalPreset(current: ScreenFilter): ScreenFilter {
  return { ...defaultFilter(), query: current.query, market: current.market, industry: current.industry };
}
export function inObservationRange(stock: AnalysisStock): boolean {
  const close = stock.metrics.close.value;
  return !!stock.range && ['整理中','回到原區間'].includes(stock.state) && close !== null && close >= stock.range.lower && close <= stock.range.upper;
}
// Unknown is distinct from false. Known false wins over unknown in an AND predicate.
export function matches(stock: AnalysisStock, filter: ScreenFilter): boolean | null {
  if (
    filter.query &&
    !`${stock.symbol} ${stock.name}`.toLowerCase().includes(filter.query.toLowerCase())
  )
    return false;
  if (
    (filter.market !== 'all' && stock.market !== filter.market) ||
    (filter.industry !== 'all' && stock.industry !== filter.industry)
  )
    return false;
  let unknown = false;
  if (filter.consolidation !== 'all') {
    if (stock.consolidating === null) unknown = true;
    else if (stock.consolidating !== (filter.consolidation === 'yes')) return false;
  }
  if (filter.direction !== 'all') {
    if (stock.direction === '未知') unknown = true;
    else if (stock.direction !== filter.direction) return false;
  }
  if (filter.state !== 'all') {
    if (stock.state === '資料排除' || stock.state === '資料不足') unknown = true;
    else if (filter.state === '區間內') {
      if (!inObservationRange(stock)) return false;
    } else if (filter.state.startsWith('今日')) {
      if (
        stock.eventDate !== stock.date ||
        stock.state !== (filter.state === '今日突破' ? '突破待確認' : '跌破區間')
      )
        return false;
    } else if (stock.state !== filter.state) return false;
  }
  for (const [key, bound] of Object.entries(filter.bounds)) {
    const value = stock.metrics[key as MetricKey]?.value;
    if (value === null || value === undefined) {
      unknown = true;
      continue;
    }
    if (
      (bound.min !== undefined && value < bound.min-1e-9) ||
      (bound.max !== undefined && value > bound.max+1e-9)
    )
      return false;
  }
  return unknown ? null : true;
}
export function sortedRows(stocks: AnalysisStock[], filter: ScreenFilter): AnalysisStock[] {
  return stocks
    .filter((s) => matches(s, filter) === true)
    .sort((a, b) => {
      if (filter.sort === 'distance' && inObservationRange(a) !== inObservationRange(b)) return inObservationRange(a) ? -1 : 1;
      const av = a.metrics[filter.sort]?.value,
        bv = b.metrics[filter.sort]?.value;
      if (av === null || av === undefined)
        return bv === null || bv === undefined ? a.symbol.localeCompare(b.symbol) : 1;
      if (bv === null || bv === undefined) return -1;
      return (av - bv) * (filter.descending ? -1 : 1) || a.symbol.localeCompare(b.symbol);
    });
}
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)];
}
export interface SavedScreen {
  id: string;
  name: string;
  filter: ScreenFilter;
  tracking: boolean;
  date?: string;
  baselineCount?: number;
  known: Record<string, { match: boolean; date: string }>;
  unknown: string[];
}
export interface ScreenEvent {
  id: string;
  conditionId: string;
  name: string;
  symbol: string;
  date: string;
  previousDate: string | null;
  state: '首次符合名單' | '新符合' | '離開條件' | '資料不足';
  snapshot: AnalysisStock;
}
export function compareCondition(
  condition: SavedScreen,
  stocks: AnalysisStock[],
  date: string,
): { condition: SavedScreen; events: ScreenEvent[] } {
  if (!condition.tracking || (condition.date && condition.date >= date))
    return { condition, events: [] };
  const next = structuredClone(condition),
    events: ScreenEvent[] = [];
  const bySymbol = new Map(stocks.map((s) => [s.symbol, s]));
  for (const symbol of new Set([...bySymbol.keys(), ...Object.keys(condition.known)])) {
    const stock = bySymbol.get(symbol),
      now = stock ? matches(stock, condition.filter) : null,
      old = condition.known[symbol];
    let state: ScreenEvent['state'] | undefined;
    if (now === null) {
      if (old && !condition.unknown.includes(symbol)) state = '資料不足';
      next.unknown = [...new Set([...next.unknown, symbol])];
    } else {
      next.unknown = next.unknown.filter((s) => s !== symbol);
      if (!condition.date && now) state = '首次符合名單';
      else if (old && now !== old.match) state = now ? '新符合' : '離開條件';
      else if (!old && condition.date && now) state = '首次符合名單';
      next.known[symbol] = { match: now, date };
    }
    if (
      state &&
      stock &&
      (state !== '首次符合名單' || events.filter((e) => e.state === '首次符合名單').length < 20)
    )
      events.push({
        id: `${condition.id}:${old?.date || 'initial'}:${date}:${symbol}:${state}`,
        conditionId: condition.id,
        name: condition.name,
        symbol,
        date,
        previousDate: old?.date || condition.date || null,
        state,
        snapshot: structuredClone(stock),
      });
  }
  if (!condition.date) next.baselineCount = Object.values(next.known).filter((s) => s.match).length;
  next.date = date;
  return { condition: next, events };
}
