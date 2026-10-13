import type { DailyBar, MarketStock } from './market-alerts.ts';

export interface ClassificationSnapshot {
  date: string;
  classificationDate?: string;
  stocks: Array<{
    symbol: string;
    market: string;
    industryCode?: string | null;
    industryDate?: string;
  }>;
}
export interface HeatComparison {
  dates: string[];
  issues: Array<{ date: string; reason: string; symbols?: string[] }>;
  excluded: Array<{
    symbol: string;
    name: string;
    industry: string;
    dates: string[];
    reason: string;
  }>;
  symbols: string[];
  available: boolean;
  currentTurnoverCoverage: number | null;
  scope: string;
}

// A fixed, verified cohort; no inferred classifications, missing amounts or new listings.
// Its percentages have a separate denominator from the full-market daily percentages.
export function heatComparison(
  universe: MarketStock[],
  all: Map<string, DailyBar[]>,
  sessions: string[],
  snapshots: Array<ClassificationSnapshot | null>,
): HeatComparison {
  const dates = sessions.slice(-21),
    issues: HeatComparison['issues'] = [],
    excluded: HeatComparison['excluded'] = [];
  const classifications = new Map(
    snapshots
      .filter((s): s is ClassificationSnapshot => !!s)
      .map((s) => [s.date, new Map(s.stocks.map((stock) => [stock.symbol, stock]))]),
  );
  const history = new Map(
    universe.map((stock) => [
      stock.symbol,
      new Map((all.get(stock.symbol) || []).map((b) => [b.date, b])),
    ]),
  );
  const reports = new Map(
    snapshots
      .filter((s): s is ClassificationSnapshot => !!s)
      .map((s) => [s.date, s.classificationDate]),
  );
  const verifiedDate = (date: string, stock: { industryDate?: string }) => {
    const published = stock.industryDate || reports.get(date);
    return (
      typeof published === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(published) && published <= date
    );
  };
  const valid = (b: DailyBar | undefined) => !!b && Number.isFinite(b.turnover) && b.turnover >= 0;
  if (dates.length < 21)
    issues.push({ date: dates.at(-1) || '未知', reason: '需當日及前 20 個交易日，交易日歷史不足' });
  for (const date of dates) {
    const registry = classifications.get(date);
    if (!registry) issues.push({ date, reason: '缺少該交易日的官方分類快照，不能用今日分類回填' });
    else
      for (const market of ['twse', 'tpex'])
        if (![...registry.values()].some((s) => s.market === market))
          issues.push({ date, reason: (market === 'twse' ? '上市' : '上櫃') + '分類名冊未涵蓋' });
    if (registry) {
      const uncertain = [...registry.values()].filter((stock) => !verifiedDate(date, stock));
      if (uncertain.length)
        issues.push({
          date,
          reason: `${uncertain.length} 檔分類資訊晚於行情日或截至日期無法核對`,
          symbols: uncertain.map((s) => s.symbol),
        });
    }
    for (const market of ['twse', 'tpex']) {
      const stocks = universe.filter((s) => s.market === market),
        missing = stocks.filter((s) => !valid(history.get(s.symbol)?.get(date)));
      if (missing.length)
        issues.push({
          date,
          reason: `${market === 'twse' ? '上市' : '上櫃'} ${missing.length} 檔成交金額缺漏`,
          symbols: missing.map((s) => s.symbol),
        });
    }
  }
  const symbols: string[] = [];
  for (const stock of universe) {
    const badDates = dates.filter((date) => {
      const prior = classifications.get(date)?.get(stock.symbol);
      return (
        !prior ||
        !('industryCode' in prior) ||
        !verifiedDate(date, prior) ||
        prior.market !== stock.market ||
        prior.industryCode !== stock.industryCode ||
        !valid(history.get(stock.symbol)?.get(date))
      );
    });
    if (badDates.length)
      excluded.push({
        symbol: stock.symbol,
        name: stock.name,
        industry: stock.industry || '未分類',
        dates: badDates,
        reason: badDates.some((d) => !classifications.get(d))
          ? '缺少分類快照'
          : badDates.some((d) => !classifications.get(d)?.has(stock.symbol))
            ? '期間未列入普通股名冊（新上市或名冊缺漏）'
            : badDates.some((d) => {
                  const s = classifications.get(d)?.get(stock.symbol);
                  return !s || s.industryCode !== stock.industryCode || s.market !== stock.market;
                })
              ? '期間市場／分類異動或未提供分類欄位'
              : badDates.some((d) => {
                    const prior = classifications.get(d)?.get(stock.symbol);
                    return !!prior && !verifiedDate(d, prior);
                  })
                ? '分類資訊晚於行情日或截至日期無法核對'
                : '成交金額缺漏',
      });
    else symbols.push(stock.symbol);
  }
  const selected = new Set(symbols),
    current = dates.at(-1)!;
  const total = universe.reduce(
    (a, s) =>
      a +
      (valid(history.get(s.symbol)?.get(current))
        ? history.get(s.symbol)!.get(current)!.turnover
        : 0),
    0,
  );
  const cohortTotal = universe
    .filter((s) => selected.has(s.symbol))
    .reduce((a, s) => a + history.get(s.symbol)!.get(current)!.turnover, 0);
  const bothMarkets = ['twse', 'tpex'].every((m) =>
    universe.some((s) => s.market === m && selected.has(s.symbol)),
  );
  const positiveDays = dates.every(
    (d) => symbols.reduce((a, s) => a + history.get(s)!.get(d)!.turnover, 0) > 0,
  );
  const available =
    dates.length === 21 && bothMarkets && positiveDays && !issues.some((i) => !i.symbols);
  if (symbols.length && !bothMarkets)
    issues.push({ date: current, reason: '固定可比樣本未同時涵蓋上市與上櫃，不代表同範圍市場' });
  if (symbols.length && !positiveDays)
    issues.push({ date: current, reason: '固定樣本有交易日總成交金額為零，無法計算占比' });
  return {
    dates,
    issues,
    excluded,
    symbols,
    available,
    currentTurnoverCoverage: total > 0 ? (cohortTotal / total) * 100 : null,
    scope: '上市＋上櫃、21 日分類與成交金額均可核對的固定普通股樣本；不代表未納入股票的熱度',
  };
}
