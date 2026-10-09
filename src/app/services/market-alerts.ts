// Shared by the Angular UI and the scheduled Node scanner. No network or clock side effects.
export const ALERT_RULES = {
  version: 'tw-daily-v1', window: 45, maxWidth: .15, maxTrend: .05,
  maxSmaChange: .03, minTurnover: 10_000_000, volumeConfirmation: 1.5,
  lowRatio: .8, highRatio: 1.3, rangeLifetime: 60, cooldown: 5,
};
export type AlertKind = '整理觀察' | '突破提醒' | '跌破提醒' | '均線偏離';
export type RangeStatus = '整理中' | '突破待確認' | '跌破區間' | '回到原區間';
export interface DailyBar {
  date: string; open: number; high: number; low: number; close: number;
  volume: number; turnover: number; rawClose: number;
}
export interface MarketStock { symbol: string; name: string; market: 'twse' | 'tpex'; }
export interface RangeSnapshot {
  id: string; date: string; lower: number; upper: number; anchorClose: number; version: string;
}
export interface AlertEvent {
  id: string; symbol: string; date: string; kind: AlertKind; status: string; reason: string;
  range?: RangeSnapshot; lower?: number; upper?: number; deviation?: number; volumeRatio?: number;
}
export interface AlertStock extends MarketStock {
  date: string; close: number; turnover: number; status: string; reason: string;
  kinds: AlertKind[]; eventDate: string; range?: RangeSnapshot; lower?: number; upper?: number;
  sma5: number; sma60: number; smaDirection: string; deviation: number; ratio: number;
  volumeRatio: number; history: DailyBar[]; eligible: boolean; exclusion?: string;
}
export interface StockScanState {
  lastDate?: string; range?: RangeSnapshot; rangeStatus?: RangeStatus;
  lastEventDate?: string;
  deviation?: 'low' | 'high' | 'normal'; retiredDate?: string;
}
export interface AlertFeed {
  schemaVersion: 1; status: 'ready' | 'error' | 'unconfigured'; message?: string;
  marketDate: string | null; scannedAt: string | null; attemptedAt?: string;
  expectedMarketDate?: string; universeCount: number; excludedCount: number;
  rules: typeof ALERT_RULES; stocks: AlertStock[]; events: AlertEvent[];
}
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const near = 1e-10;
export function consolidation(bars: DailyBar[], rules = ALERT_RULES) {
  if (bars.length < 70) return null;
  const recent = bars.slice(-rules.window), closes = recent.map(b => b.close);
  const lower = Math.min(...recent.map(b => b.low)), upper = Math.max(...recent.map(b => b.high));
  const center = (closes.length - 1) / 2, avg = mean(closes);
  const slope = closes.reduce((sum, y, x) => sum + (x - center) * (y - avg), 0) /
    closes.reduce((sum, _, x) => sum + (x - center) ** 2, 0);
  // OLS slope × (N−1) / arithmetic mean of the N closes.
  const trend = slope * (closes.length - 1) / avg;
  const smaChange = mean(bars.slice(-60).map(b => b.close)) / mean(bars.slice(-70, -10).map(b => b.close)) - 1;
  const width = upper / lower - 1, turnover = mean(recent.map(b => b.turnover));
  return { lower, upper, width, trend, smaChange, turnover,
    matches: width <= rules.maxWidth + near && Math.abs(trend) <= rules.maxTrend + near &&
      Math.abs(smaChange) <= rules.maxSmaChange + near && turnover >= rules.minTurnover };
}
export function validHistory(bars: DailyBar[], sessions: string[], date: string): string | null {
  const expected = sessions.filter(d => d <= date).slice(-70);
  const recent = bars.filter(b => b.date <= date).slice(-70);
  if (expected.length < 70 || recent.length < 70) return '歷史不足 70 個交易日';
  if (recent.some((b, i) => b.date !== expected[i])) return '停牌或交易日資料缺漏';
  if (recent.some(b => ![b.open,b.high,b.low,b.close,b.rawClose,b.volume,b.turnover].every(Number.isFinite) ||
    b.low <= 0 || b.rawClose <= 0 || b.high < Math.max(b.open,b.close,b.low) || b.low > Math.min(b.open,b.close) || b.volume < 0 || b.turnover < 0)) return '行情數值異常';
  if (recent.slice(-45).some(b => b.volume === 0)) return '近 45 個交易日有無成交日';
  return null;
}
export function deviationState(ratio: number, rules = ALERT_RULES): 'low' | 'high' | 'normal' {
  return ratio <= rules.lowRatio + near ? 'low' : ratio >= rules.highRatio - near ? 'high' : 'normal';
}
export function scanStock(stock: MarketStock, bars: DailyBar[], sessions: string[], previous: StockScanState = {}, rules = ALERT_RULES) {
  const state: StockScanState = structuredClone(previous), events: AlertEvent[] = [];
  let row: AlertStock | null = null;
  const ordered = [...bars].sort((a,b) => a.date.localeCompare(b.date));
  const target = sessions.at(-1)!;
  // First installation is a current snapshot, not a fabricated historical event backfill.
  const dates = previous.lastDate ? sessions.filter(d => d > previous.lastDate!) : [target];
  const evaluate = (date: string, emit: boolean) => {
    const original = ordered.filter(b => b.date <= date), last = original.at(-1);
    let exclusion = validHistory(original, sessions, date);
    if (!exclusion && mean(original.slice(-45).map(b=>b.turnover)) < rules.minTurnover) exclusion = '近 45 日平均成交金額低於流動性門檻';
    if (!last) return;
    const scale = last.rawClose > 0 && last.close > 0 ? last.rawClose / last.close : 1;
    const history = original.map(b => ({ ...b, open:b.open*scale, high:b.high*scale, low:b.low*scale, close:b.close*scale }));
    const latest = history.at(-1)!, sma5 = mean(history.slice(-5).map(b => b.close)), sma60 = mean(history.slice(-60).map(b => b.close));
    const smaOld = mean(history.slice(-70,-10).map(b => b.close));
    const ratio = sma60 > 0 ? sma5 / sma60 : 1, deviation = (ratio-1)*100;
    const volumeMean = mean(history.slice(-21,-1).map(b => b.volume));
    const volumeRatio = volumeMean > 0 ? latest.volume / volumeMean : 0;
    const kinds: AlertKind[] = []; let status = '未符合觀察條件', reason = '目前未符合整理或均線偏離觀察門檻。';
    let lower: number | undefined, upper: number | undefined;
    const push = (kind: AlertKind, eventStatus: string, text: string) => {
      if (emit) { state.lastEventDate = date; events.push({ id:`${rules.version}:${stock.symbol}:${date}:${kind}:${eventStatus}:${state.range?.id ?? ''}`,
        symbol:stock.symbol, date, kind, status:eventStatus, reason:text,
        range: state.range ? structuredClone(state.range) : undefined, lower, upper, deviation, volumeRatio }); }
    };
    if (!exclusion) {
      if (state.range) {
        const anchor = original.find(b => b.date === state.range!.date);
        const age = sessions.filter(d => d > state.range!.date && d <= date).length;
        if (!anchor || age > rules.rangeLifetime || state.range.version !== rules.version) {
          push('整理觀察', '區間失效', '原區間已到期或規則版本改變，停止沿用。');
          state.range = undefined; state.rangeStatus = undefined; state.retiredDate = date;
        } else {
          // Rebase saved bounds with the historical anchor's new adjustment factor.
          const factor = anchor.close * scale / state.range.anchorClose;
          lower = state.range.lower * factor; upper = state.range.upper * factor;
        }
      }
      if (!state.range && (!state.retiredDate || sessions.filter(d => d > state.retiredDate! && d <= date).length >= rules.cooldown)) {
        const range = consolidation(history, rules);
        if (range?.matches) {
          lower = range.lower; upper = range.upper;
          state.range = { id:`${stock.symbol}:${date}:${rules.version}`, date, lower, upper, anchorClose:last.rawClose, version:rules.version };
          state.rangeStatus = '整理中';
          push('整理觀察', '整理中', `近 ${rules.window} 個交易日主要在 ${lower.toFixed(2)}～${upper.toFixed(2)} 元間整理。`);
        }
      }
      if (state.range && lower !== undefined && upper !== undefined) {
        const next: RangeStatus = latest.close > upper + near ? '突破待確認' : latest.close < lower - near ? '跌破區間' :
          state.rangeStatus === '突破待確認' || state.rangeStatus === '跌破區間' || state.rangeStatus === '回到原區間' ? '回到原區間' : '整理中';
        const kind: AlertKind = next === '突破待確認' ? '突破提醒' : next === '跌破區間' ? '跌破提醒' : '整理觀察';
        status = next; kinds.push(kind);
        reason = next === '突破待確認' ? `收盤突破已保存區間上緣 ${upper.toFixed(2)} 元，仍待後續確認。` :
          next === '跌破區間' ? `收盤跌破已保存區間下緣 ${lower.toFixed(2)} 元。` :
          next === '回到原區間' ? '收盤重新回到原整理區間。' : `近 ${rules.window} 日辨識的區間持續觀察：${lower.toFixed(2)}～${upper.toFixed(2)} 元。`;
        if (next !== state.rangeStatus) push(kind, next, reason);
        state.rangeStatus = next;
      }
      const nextDeviation = deviationState(ratio, rules);
      const deviationReason = `近 5 日平均價比近 60 日平均價${deviation < 0 ? '低' : '高'} ${Math.abs(deviation).toFixed(1)}%。`;
      if (nextDeviation !== 'normal') {
        kinds.push('均線偏離');
        if (!state.range) { status = nextDeviation === 'low' ? '均線偏低' : '均線偏高'; reason = deviationReason; }
      }
      if (nextDeviation !== state.deviation && (state.deviation !== undefined || nextDeviation !== 'normal'))
        push('均線偏離', nextDeviation === 'normal' ? '離開偏離門檻' : nextDeviation === 'low' ? '均線偏低' : '均線偏高', nextDeviation === 'normal' ? '均線偏離已回到觀察門檻內。' : deviationReason);
      state.deviation = nextDeviation;
    }
    if (emit) state.lastDate = date;
    row = { ...stock, date:last.date, close:last.rawClose, turnover:last.turnover, status:exclusion ? '資料排除' : status,
      reason:exclusion || reason, kinds:exclusion ? [] : kinds, eventDate:state.lastEventDate || date,
      range:state.range ? structuredClone(state.range) : undefined, lower, upper, sma5, sma60, ratio, deviation,
      smaDirection:sma60 < smaOld ? '中期均線向下' : sma60 > smaOld ? '中期均線向上' : '中期均線持平',
      volumeRatio, history:history.slice(-100).filter(b=>[b.open,b.high,b.low,b.close,b.rawClose,b.volume,b.turnover].every(Number.isFinite) && b.close>0), eligible:!exclusion, exclusion:exclusion || undefined };
  };
  for (const date of dates) evaluate(date, true);
  if (!row) evaluate(target, false);
  return { state, events, row:row as AlertStock | null };
}
