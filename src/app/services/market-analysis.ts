import { ALERT_RULES } from './market-alerts.ts';
import type { DailyBar, MarketStock, AlertStock } from './market-alerts.ts';
import type { HeatComparison } from './market-heat-comparison.ts';

export const INDUSTRIES: Record<string, string> = {
  '01': '水泥工業',
  '02': '食品工業',
  '03': '塑膠工業',
  '04': '紡織纖維',
  '05': '電機機械',
  '06': '電器電纜',
  '08': '玻璃陶瓷',
  '09': '造紙工業',
  '10': '鋼鐵工業',
  '11': '橡膠工業',
  '12': '汽車工業',
  '14': '建材營造',
  '15': '航運業',
  '16': '觀光餐旅',
  '17': '金融保險',
  '18': '貿易百貨',
  '19': '綜合',
  '20': '其他',
  '21': '化學工業',
  '22': '生技醫療業',
  '23': '油電燃氣業',
  '24': '半導體業',
  '25': '電腦及週邊設備業',
  '26': '光電業',
  '27': '通信網路業',
  '28': '電子零組件業',
  '29': '電子通路業',
  '30': '資訊服務業',
  '31': '其他電子業',
  '32': '文化創意業',
  '33': '農業科技業',
  '34': '電子商務業',
  '35': '綠能環保',
  '36': '數位雲端',
  '37': '運動休閒',
  '38': '居家生活',
};
export type Metric = { value: number | null; reason: string | null };
export type MetricKey =
  | 'close'
  | 'volume'
  | 'turnover'
  | 'sma5'
  | 'sma60'
  | 'width'
  | 'trend'
  | 'smaChange'
  | 'deviation'
  | 'averageTurnover'
  | 'zeroDays'
  | 'volatility'
  | 'change'
  | 'distance';
export type Metrics = Record<MetricKey, Metric>;
export interface AnalysisStock extends MarketStock {
  industry: string;
  industryCode: string | null;
  date: string;
  metrics: Metrics;
  direction: '上升' | '下降' | '平穩' | '未知';
  smaDirection: string;
  consolidating: boolean | null;
  state: string;
  stateReason?: string;
  eventDate: string | null;
  range?: AlertStock['range'];
  lower: number | null;
  upper: number | null;
  availability: 'complete' | 'partial' | 'none';
}
export interface IndustryHeat {
  comparisonShare?: number|null;
  comparisonStocks?: number;
  industry: string;
  turnover: number;
  share: number;
  averageShare: number | null;
  changePoints: number | null;
  up: number;
  down: number;
  flat: number;
  unknown: number;
  valid: number;
  total: number;
  top: Array<{ symbol: string; name: string; turnover: number }>;
  concentration: number | null;
  comparisonReason: string | null;
}
export interface MarketAnalysisFeed {
  heatComparison?: HeatComparison;
  expectedDate?: string;
  dataDelay?: string;
  calendarYears?:number[];
  closedDates?:string[];
  schemaVersion: 2;
  date: string;
  scannedAt: string;
  status: 'ready' | 'error';
  message?: string;
  basis: string;
  stocks: AnalysisStock[];
  industryHeat: IndustryHeat[];
  coverage: {
    checked: number;
    total: number;
    complete: number;
    partial: number;
    none: number;
    twse: number;
    tpex: number;
  };
  volatilityDefinition: string;
  classificationDate: string;
  historyVersion?: string;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const metric = (value: number | null, reason: string | null = null): Metric => ({
  value,
  reason: value === null ? reason || '資料不足' : null,
});
const validPrice = (b: DailyBar) =>
  !b.dataIssue &&
  [b.open, b.high, b.low, b.close].every((v) => Number.isFinite(v) && v > 0) &&
  b.high >= Math.max(b.open, b.close, b.low) &&
  b.low <= Math.min(b.open, b.close);
const validClose=(b:DailyBar)=>Number.isFinite(b.close)&&b.close>0&&Number.isFinite(b.rawClose)&&b.rawClose>0&&(b.high<=0||b.high>=b.close)&&(b.low<=0||b.low<=b.close);
export function analyzeStock(
  stock: MarketStock,
  bars: DailyBar[],
  sessions: string[],
  basis: string,
  row?: AlertStock | null,
): AnalysisStock {
  const date = sessions.at(-1)!,
    source = bars.filter((b) => b.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const last = source.at(-1),
    scale =
      basis === 'adjusted' && last && last.close > 0 && last.rawClose > 0
        ? last.rawClose / last.close
        : 1;
  const ordered = source.map((b) => ({
      ...b,
      open: b.open * scale,
      high: b.high * scale,
      low: b.low * scale,
      close: b.close * scale,
    })),
    current = ordered.find((b) => b.date === date);
  const window = (
    n: number,
    price: 'close' | 'ohlc' | 'turnover' | 'volume' = 'close',
  ): { bars: DailyBar[]; reason: string | null } => {
    const expected = sessions.slice(-n),
      slice = ordered.filter((b) => expected.includes(b.date));
    if (expected.length < n || slice.length < n)
      return { bars: slice, reason: '歷史不足或交易日缺漏（需 ' + n + ' 日）' };
    if (slice.some((b, i) => b.date !== expected[i]))
      return { bars: slice, reason: '交易日缺漏或停牌' };
    if (
      (price === 'ohlc' && slice.some((b) => !validPrice(b))) ||
      (price === 'close' && slice.some((b) => !validClose(b)))
    )
      return { bars: slice, reason: '未公告所需價格或行情異常' };
    if (['close', 'ohlc'].includes(price) && basis !== 'adjusted' && slice.some((b) => b.action))
      return { bars: slice, reason: '原始價格期間有公司行動或基準未確認，需可靠還原資料' };
    if (
      (price === 'turnover' && slice.some((b) => !Number.isFinite(b.turnover) || b.turnover < 0)) ||
      (price === 'volume' && slice.some((b) => !Number.isFinite(b.volume) || b.volume < 0))
    )
      return { bars: slice, reason: '成交資料缺漏' };
    return { bars: slice, reason: null };
  };
  const metrics = {
    close: metric(current&&validClose(current) ? current.rawClose : null, '當日無有效價格'),
    volume: metric(
      current && Number.isFinite(current.volume) && current.volume >= 0 ? current.volume : null,
      '當日成交量缺漏',
    ),
    turnover: metric(
      current && Number.isFinite(current.turnover) && current.turnover >= 0
        ? current.turnover
        : null,
      '當日成交金額缺漏',
    ),
  } as Metrics;
  for (const [key, n] of [
    ['sma5', 5],
    ['sma60', 60],
  ] as const) {
    const w = window(n);
    metrics[key] = metric(w.reason ? null : mean(w.bars.map((b) => b.close)), w.reason);
  }
  const w45 = window(45),
    ohlc45 = window(45, 'ohlc'),
    w70 = window(70),
    v45 = window(45, 'turnover'),
    volume45 = window(45, 'volume'),
    w21 = window(21);
  const prices = w45.bars.map((b) => b.close),
    avg = prices.length ? mean(prices) : 0,
    center = (prices.length - 1) / 2;
  const trend = w45.reason
    ? null
    : (((prices.reduce((a, v, i) => a + (i - center) * (v - avg), 0) /
        prices.reduce((a, _, i) => a + (i - center) ** 2, 0)) *
        44) /
        avg) *
      100;
  const width = ohlc45.reason
    ? null
    : (Math.max(...ohlc45.bars.map((b) => b.high)) / Math.min(...ohlc45.bars.map((b) => b.low)) -
        1) *
      100;
  const smaChange = w70.reason
    ? null
    : (mean(w70.bars.slice(-60).map((b) => b.close)) /
        mean(w70.bars.slice(0, 60).map((b) => b.close)) -
        1) *
      100;
  metrics.width = metric(width, ohlc45.reason);
  metrics.trend = metric(trend, w45.reason);
  metrics.smaChange = metric(smaChange, w70.reason);
  const sma5 = metrics.sma5.value,
    sma60 = metrics.sma60.value;
  metrics.deviation = metric(
    sma5 !== null && sma60 !== null ? (sma5 / sma60 - 1) * 100 : null,
    metrics.sma5.reason || metrics.sma60.reason,
  );
  metrics.averageTurnover = metric(
    v45.reason ? null : mean(v45.bars.map((b) => b.turnover)),
    v45.reason,
  );
  metrics.zeroDays = metric(
    volume45.reason ? null : volume45.bars.filter((b) => b.volume === 0).length,
    volume45.reason,
  );
  const returns = w21.bars.slice(1).map((b, i) => b.close / w21.bars[i].close - 1),
    rmean = returns.length ? mean(returns) : 0;
  metrics.volatility = metric(
    w21.reason
      ? null
      : Math.sqrt(returns.reduce((a, r) => a + (r - rmean) ** 2, 0) / (returns.length - 1)) * 100,
    w21.reason,
  );
  const change = (current as DailyBar & { change?: number | null })?.change,
    prior = ordered.filter((b) => b.date < date).at(-1);
  const reference =
    current && typeof change === 'number' && Number.isFinite(change)
      ? current.rawClose - change
      : current && !current.action && prior && validPrice(prior)
        ? basis==='adjusted'?prior.close:prior.rawClose
        : null;
  metrics.change = metric(
    current && validPrice(current) && reference !== null && reference > 0
      ? (current.rawClose / reference - 1) * 100
      : null,
    '沒有有效比較價',
  );
  const lower = row?.eligible ? (row.lower ?? null) : null,
    upper = row?.eligible ? (row.upper ?? null) : null;
  metrics.distance = metric(
    upper !== null && current && current.rawClose > 0 ? (upper / current.rawClose - 1) * 100 : null,
    '目前無有效保存區間',
  );
  const technical: MetricKey[] = [
    'width',
    'trend',
    'sma5',
    'sma60',
    'deviation',
    'smaChange',
    'volatility',
    'averageTurnover',
    'zeroDays',
  ];
  const available = technical.filter((k) => metrics[k].value !== null).length;
  const code = stock.industryCode || null;
  return {
    ...stock,
    industryCode: code,
    industry: stock.industry || '未分類',
    date,
    metrics,
    direction: trend === null ? '未知' : trend > 1 ? '上升' : trend < -1 ? '下降' : '平穩',
    smaDirection:
      smaChange === null
        ? '中期方向未知'
        : smaChange > 0
          ? '中期均線向上'
          : smaChange < 0
            ? '中期均線向下'
            : '中期均線持平',
    consolidating:
      width === null || trend === null || smaChange === null
        ? null
        : width <= ALERT_RULES.maxWidth * 100 + 1e-8 &&
          Math.abs(trend) <= ALERT_RULES.maxTrend * 100 + 1e-8 &&
          Math.abs(smaChange) <= ALERT_RULES.maxSmaChange * 100 + 1e-8,
    state: row?.eligible ? row.status : '資料不足',
    stateReason:row?.exclusion||row?.reason||'沒有可用的區間觀察依據，請查看各指標原因',
    eventDate: row?.eventDate || null,
    range: row?.eligible ? row.range : undefined,
    lower,
    upper,
    availability:
      available === technical.length ? 'complete' : available === 0 ? 'none' : 'partial',
  };
}
export function industryHeat(
  universe: MarketStock[],
  all: Map<string, DailyBar[]>,
  sessions: string[],
  classificationComparable: boolean | HeatComparison,
): IndustryHeat[] {
  const date = sessions.at(-1)!,
    groups = [...new Set(universe.map((s) => s.industry || '未分類'))];
  const days = sessions.slice(-21),
    valid = (b: DailyBar | undefined) => !!b && Number.isFinite(b.turnover) && b.turnover >= 0;
  const dayTotals = new Map(
    days.map((d) => [
      d,
      universe.reduce((a, s) => {
        const b = all.get(s.symbol)?.find((b) => b.date === d);
        return a + (valid(b) ? b!.turnover : 0);
      }, 0),
    ]),
  );
  const cohort=typeof classificationComparable==='boolean'?universe:universe.filter(s=>classificationComparable.symbols.includes(s.symbol));
  const comparisonTotals=new Map(days.map(d=>[d,cohort.reduce((a,s)=>a+(all.get(s.symbol)?.find(b=>b.date===d)?.turnover||0),0)]));
  const completeDays = days
    .slice(0, -1)
    .filter(
      (d) =>
        dayTotals.get(d)! > 0 &&
        cohort.every((s) => valid(all.get(s.symbol)?.find((b) => b.date === d))),
    );
  const comparable =
    (typeof classificationComparable==='boolean'?classificationComparable:classificationComparable.available) &&
    completeDays.length === 20 &&
    cohort.every((s) => valid(all.get(s.symbol)?.find((b) => b.date === date)));
  return groups
    .map((industry) => {
      const members = universe.filter((s) => (s.industry || '未分類') === industry),
        current = members.map((s) => ({ s, b: all.get(s.symbol)?.find((b) => b.date === date) })),
        usable = current.filter((x) => valid(x.b)),
        turnover = usable.reduce((a, x) => a + x.b!.turnover, 0),
        total = dayTotals.get(date) || 0;
      const comparisonMembers=members.filter(s=>cohort.some(c=>c.symbol===s.symbol));
      const comparisonShare=comparable&&comparisonMembers.length ? comparisonMembers.reduce((a,s)=>a+all.get(s.symbol)!.find(b=>b.date===date)!.turnover,0)/comparisonTotals.get(date)!*100:null;
      const averageShare = comparable&&comparisonMembers.length
        ? mean(
            completeDays.map(
              (d) =>
                comparisonMembers.reduce(
                  (a, s) => a + all.get(s.symbol)!.find((b) => b.date === d)!.turnover,
                  0,
                ) / comparisonTotals.get(d)!,
            ),
          ) * 100
        : null;
      let up = 0,
        down = 0,
        flat = 0,
        unknown = 0;
      for (const { s, b } of current) {
        const prior = all
          .get(s.symbol)
          ?.filter((p) => p.date < date)
          .at(-1);
        const delta = (b as DailyBar & { change?: number | null })?.change;
        const change =
          typeof delta === 'number'
            ? delta
            : b && prior && !b.action && validPrice(b) && validPrice(prior)
              ? b.rawClose - prior.rawClose
              : null;
        if (!b || !validPrice(b) || change === null) {
          unknown++;
        } else if (change > 0) up++;
        else if (change < 0) down++;
        else flat++;
      }
      const top = usable
        .sort((a, b) => b.b!.turnover - a.b!.turnover)
        .slice(0, 3)
        .map((x) => ({ symbol: x.s.symbol, name: x.s.name, turnover: x.b!.turnover }));
      const share = total > 0 ? (turnover / total) * 100 : 0;
      return {
        industry,
        turnover,
        share,
        averageShare,
        comparisonShare,
        comparisonStocks:comparisonMembers.length,
        changePoints: averageShare === null || comparisonShare===null ? null : comparisonShare - averageShare,
        up,
        down,
        flat,
        unknown,
        valid: usable.length,
        total: members.length,
        top,
        concentration:
          turnover > 0 ? (top.reduce((a, s) => a + s.turnover, 0) / turnover) * 100 : null,
        comparisonReason: averageShare!==null ? null : typeof classificationComparable==='boolean'?'前 20 日普通股覆蓋或分類一致性未通過，不能比較':classificationComparable.issues.find(i=>!i.symbols)?.reason||'本產業沒有符合 21 日完整分類與成交金額的固定可比樣本',
      };
    })
    .sort((a, b) => b.turnover - a.turnover);
}
