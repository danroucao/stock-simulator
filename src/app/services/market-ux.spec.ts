import { describe, expect, it } from 'vitest';
import { heatComparison, ClassificationSnapshot } from './market-heat-comparison';
import { industryHeat } from './market-analysis';
import { DailyBar, MarketStock } from './market-alerts';
import { defaultFilter, filterFromQuery, technicalPreset } from './screening';
import { amount, boundLabel, chartChange } from './market-presentation';

// Isolated synthetic fixtures, never published as market data.
const companies: MarketStock[] = [
  { symbol: '2330', name: '甲', market: 'twse', industry: '半導體', industryCode: '24' },
  { symbol: '6488', name: '乙', market: 'tpex', industry: '半導體', industryCode: '24' },
  { symbol: '2603', name: '新公司', market: 'twse', industry: '航運', industryCode: '15' },
];
function fixture() {
  const dates = Array.from({ length: 21 }, (_, i) => '2026-01-' + String(i + 1).padStart(2, '0'));
  const all = new Map(
    companies.map((stock) => [
      stock.symbol,
      dates.map(
        (date, i) =>
          ({
            symbol: stock.symbol,
            date,
            open: 50,
            high: 51,
            low: 49,
            close: 50,
            rawClose: 50,
            volume: 10,
            turnover:
              stock.symbol === '2603' ? 10000 : i === 20 && stock.symbol === '2330' ? 300 : 100,
          }) as DailyBar,
      ),
    ]),
  );
  const snapshots: ClassificationSnapshot[] = dates.map((date) => ({
    date,
    stocks: companies.map((s) => ({ ...s, industryDate: date })),
  }));
  return { dates, all, snapshots };
}
describe('fixed verified industry comparison cohort', () => {
  it('does not use classification information published after the quote date', () => {
    const { dates, all, snapshots } = fixture();
    snapshots[2].stocks[2].industryDate = dates[3];
    const scope = heatComparison(companies, all, dates, snapshots);
    expect(scope.symbols).not.toContain('2603');
    expect(scope.available).toBe(true);
    expect(scope.issues.some((i) => i.date === dates[2] && i.reason.includes('晚於行情日'))).toBe(
      true,
    );
  });
  it('isolates new listings while comparing only a constant verified denominator', () => {
    const { dates, all, snapshots } = fixture();
    snapshots[0].stocks = snapshots[0].stocks.filter((s) => s.symbol !== '2603');
    const scope = heatComparison(companies, all, dates, snapshots);
    expect(scope.available).toBe(true);
    expect(scope.symbols).toEqual(['2330', '6488']);
    expect(scope.excluded[0].dates).toEqual([dates[0]]);
    const rows = industryHeat(companies, all, dates, scope),
      semi = rows.find((r) => r.industry === '半導體')!;
    expect(semi.share).toBeCloseTo((400 / 10400) * 100);
    expect(semi.comparisonShare).toBe(100);
    expect(semi.averageShare).toBe(100);
    expect(semi.changePoints).toBe(0);
    expect(rows.find((r) => r.industry === '航運')?.changePoints).toBeNull();
  });
  it('reports exact missing classification dates without reconstructing them', () => {
    const { dates, all, snapshots } = fixture();
    const scope = heatComparison(
      companies,
      all,
      dates,
      snapshots.filter((_, i) => i !== 8),
    );
    expect(scope.available).toBe(false);
    expect(scope.issues.some((i) => i.date === dates[8] && i.reason.includes('分類快照'))).toBe(
      true,
    );
    expect(industryHeat(companies, all, dates, scope).every((r) => r.changePoints === null)).toBe(
      true,
    );
  });
  it('excludes classification changes and missing turnover without excluding valid price-affected amounts', () => {
    const { dates, all, snapshots } = fixture();
    snapshots[3].stocks[2].industryCode = '20';
    all.get('2330')![5].action = '除權息';
    const scope = heatComparison(companies, all, dates, snapshots);
    expect(scope.available).toBe(true);
    expect(scope.symbols).toContain('2330');
    expect(scope.symbols).not.toContain('2603');
    expect(scope.excluded[0].reason).toContain('分類異動');
    all.get('6488')!.splice(7, 1);
    const partial = heatComparison(companies, all, dates, snapshots);
    expect(partial.available).toBe(false);
    expect(partial.issues.some((i) => i.date === dates[7] && i.symbols?.includes('6488'))).toBe(
      true,
    );
  });
  it('rejects one-market classification snapshots rather than calling them a whole-market comparison', () => {
    const { dates, all, snapshots } = fixture();
    snapshots[2].stocks = snapshots[2].stocks.filter((s) => s.market === 'twse');
    expect(heatComparison(companies, all, dates, snapshots).available).toBe(false);
  });
});
describe('screen context and presentation', () => {
  it('uses real raw signed changes and marks missing or incompatible changes unknown', () => {
    const bar = fixture().all.get('2330')![0];
    expect(chartChange({ ...bar, change: 3 }, 'raw-action-screened')).toEqual({
      change: 3,
      changeKnown: true,
    });
    expect(chartChange({ ...bar, change: null }, 'raw-action-screened').changeKnown).toBe(false);
    expect(chartChange({ ...bar, change: 3 }, 'adjusted').changeKnown).toBe(false);
  });
  it('preserves search, market and industry when clearing technical presets', () => {
    const f = {
      ...defaultFilter(),
      query: '航',
      market: 'twse',
      industry: '航運',
      bounds: { volatility: { min: 2.88 } },
    };
    const next = technicalPreset(f);
    expect(next.industry).toBe('航運');
    expect(next.market).toBe('twse');
    expect(next.query).toBe('航');
    expect(next.bounds).toEqual({});
  });
  it('uses one canonical full filter after back/reload even with a stale industry query', () => {
    const f = {
      ...defaultFilter(),
      market: 'tpex',
      industry: '航運',
      bounds: { volatility: { min: 2.88 } },
    };
    expect(
      filterFromQuery({ filter: JSON.stringify(f), industry: '半導體' }, defaultFilter()),
    ).toEqual(f);
    expect(filterFromQuery({ industry: '航運' }, f).bounds).toEqual({});
    expect(filterFromQuery({}, f)).toEqual(f);
  });
  it('rejects invalid URL predicates and never parses unknown numeric fields', () => {
    expect(filterFromQuery({ filter: 'not-json' }, defaultFilter())).toEqual(defaultFilter());
    expect(
      filterFromQuery(
        { filter: JSON.stringify({ ...defaultFilter(), bounds: { width: { min: null } } }) },
        defaultFilter(),
      ),
    ).toEqual(defaultFilter());
  });
  it('formats money and one-sided conditions without exposing machine precision', () => {
    expect(amount(3080000000)).toBe('30.80 億元');
    expect(amount(32500)).toBe('3.25 萬元');
    expect(amount(null)).toBe('未知');
    expect(boundLabel('volatility', '20 日波動率（%）', { min: 2.88 })).toBe('20 日波動率 ≥ 2.88%');
  });
});
