import { ALERT_RULES, consolidation, deviationState, scanStock, validHistory, DailyBar } from './market-alerts';

function fixture(count=100): DailyBar[] {
  const date = new Date('2026-03-02T00:00:00Z'), rows: DailyBar[] = [];
  while(rows.length<count) {
    if (![0,6].includes(date.getUTCDay())) rows.push({date:date.toISOString().slice(0,10),open:50,high:52,low:47,close:50,rawClose:50,volume:1_000_000,turnover:50_000_000});
    date.setUTCDate(date.getUTCDate()+1);
  }
  return rows;
}
const stock = {symbol:'2330',name:'測試用股票',market:'twse' as const};
describe('daily market alert rules',()=>{
  it('excludes corporate actions for a complete 70-session window and never emits false breakouts',()=>{
    const bars=fixture(180), sessions=bars.map(b=>b.date), initial=scanStock(stock,bars.slice(0,90),sessions.slice(0,90));
    const snapshot=structuredClone(initial.state.range);
    for(let i=90;i<bars.length;i++) bars[i]={...bars[i],open:25,high:26,low:23.5,close:25,rawClose:25};
    bars[90].action='面額變更／分割';
    const impacted=scanStock(stock,bars.slice(0,91),sessions.slice(0,91),initial.state);
    expect(impacted.row!.eligible).toBe(false);expect(impacted.row!.exclusion).toContain('價格基準異動');expect(impacted.events).toEqual([]);expect(impacted.state.range).toEqual(snapshot);
    const stillExcluded=scanStock(stock,bars.slice(0,160),sessions.slice(0,160),impacted.state);
    expect(stillExcluded.row!.eligible).toBe(false);expect(stillExcluded.events).toEqual([]);
    const recovered=scanStock(stock,bars.slice(0,161),sessions.slice(0,161),stillExcluded.state);
    expect(recovered.row!.eligible).toBe(true);expect(recovered.events.every(e=>e.kind!=='跌破提醒')).toBe(true);
    expect(recovered.events.some(e=>e.status==='區間失效')).toBe(true);
  });
  it('labels unannounced prices as incomplete data and does not create events',()=>{
    const bars=fixture(), sessions=bars.map(b=>b.date);bars[80].dataIssue='有成交但未公告完整價格';
    const result=scanStock(stock,bars,sessions);
    expect(result.row!.exclusion).toContain('資料不完整');expect(result.events).toEqual([]);
  });
  it('requires all three conditions and accepts inclusive boundaries',()=>{
    const bars=fixture(); const result=consolidation(bars)!;
    expect(result.matches).toBe(true); expect(result.trend).toBe(0); expect(result.smaChange).toBe(0);
    const widthFail=structuredClone(bars); widthFail.at(-1)!.high=60;
    expect(consolidation(widthFail)!.matches).toBe(false);
    const trendFail=bars.map((b,i)=>({...b,open:50+i*.1,close:50+i*.1,rawClose:50+i*.1,low:50+i*.1,high:50+i*.1}));
    const trend=consolidation(trendFail)!;
    expect(Math.abs(trend.trend)).toBeGreaterThan(.05);
    expect(consolidation(trendFail,{...ALERT_RULES,maxSmaChange:1})!.matches).toBe(false);
    const smaFail=bars.map((b,i)=>({...b,open:i<55?40:50,close:i<55?40:50,rawClose:i<55?40:50,low:i<55?40:47,high:i<55?40:52}));
    expect(consolidation(smaFail)!.trend).toBe(0);
    expect(consolidation(smaFail)!.smaChange).toBeGreaterThan(.03);
    expect(consolidation(smaFail)!.matches).toBe(false);
    expect(consolidation(bars,{...ALERT_RULES,maxWidth:result.width,maxTrend:0,maxSmaChange:0,minTurnover:result.turnover})!.matches).toBe(true);
    expect(consolidation(bars.slice(-69))).toBeNull();
  });
  it('excludes missing sessions, zero volume, bad OHLC and low liquidity',()=>{
    const bars=fixture(), sessions=bars.map(b=>b.date);
    expect(validHistory(bars.slice(1),sessions,sessions.at(-1)!)).toBeNull();
    expect(validHistory(bars.slice(-69),sessions,sessions.at(-1)!)).toContain('不足');
    const missing=bars.filter((_,i)=>i!==80);
    expect(validHistory(missing,sessions,sessions.at(-1)!)).toContain('缺漏');
    const zero=structuredClone(bars); zero.at(-1)!.volume=0;
    expect(scanStock(stock,zero,sessions).row!.eligible).toBe(false);
    const bad=structuredClone(bars); bad.at(-1)!.high=40;
    expect(validHistory(bad,sessions,sessions.at(-1)!)).toContain('異常');
    expect(scanStock(stock,bars.map(b=>({...b,turnover:1})),sessions).row!.exclusion).toContain('流動性');
  });
  it('breaks against a prior snapshot without including the current high; reruns are idempotent',()=>{
    const bars=fixture(), sessions=bars.map(b=>b.date);
    const first=scanStock(stock,bars.slice(0,90),sessions.slice(0,90));
    const snapshot=structuredClone(first.state.range)!;
    bars[90]={...bars[90],close:53,rawClose:53,high:80,volume:2_000_000};
    const breakout=scanStock(stock,bars.slice(0,91),sessions.slice(0,91),first.state);
    expect(breakout.row!.status).toBe('突破待確認');
    expect(breakout.events[0].volumeRatio).toBe(2);
    expect(breakout.state.range).toEqual(snapshot); expect(first.state.range).toEqual(snapshot);
    const rerun=scanStock(stock,bars.slice(0,91),sessions.slice(0,91),breakout.state);
    expect(rerun.events).toEqual([]); expect(rerun.state).toEqual(breakout.state);
    const reentry=scanStock(stock,bars.slice(0,92),sessions.slice(0,92),breakout.state);
    expect(reentry.row!.status).toBe('回到原區間');
    bars[92]={...bars[92],close:53,rawClose:53,high:54};
    const again=scanStock(stock,bars.slice(0,93),sessions.slice(0,93),reentry.state);
    expect(again.events.some(e=>e.kind==='突破提醒')).toBe(true);
    bars[93]={...bars[93],close:46,rawClose:46,low:45};
    expect(scanStock(stock,bars.slice(0,94),sessions.slice(0,94),again.state).row!.status).toBe('跌破區間');
  });
  it('rebases an immutable snapshot after a split and does not create a false breakdown',()=>{
    const bars=fixture(), sessions=bars.map(b=>b.date), first=scanStock(stock,bars.slice(0,90),sessions.slice(0,90));
    const split=bars.slice(0,91).map(b=>({...b,open:b.open/2,high:b.high/2,low:b.low/2,close:b.close/2}));
    split[90].rawClose=25;
    const next=scanStock(stock,split,sessions.slice(0,91),first.state);
    expect(next.row!.lower).toBe(23.5); expect(next.row!.upper).toBe(26);
    expect(next.row!.status).toBe('整理中'); expect(next.events).toEqual([]);
    expect(next.state.range!.lower).toBe(47);
  });
  it('emits deviation entry, exit and reentry once, including threshold boundaries',()=>{
    expect(deviationState(.8)).toBe('low'); expect(deviationState(1.3)).toBe('high'); expect(deviationState(.8001)).toBe('normal');
    const bars=fixture(110), sessions=bars.map(b=>b.date);
    for(let i=90;i<95;i++) bars[i]={...bars[i],open:30,high:31,low:29,close:30,rawClose:30};
    const initial=scanStock(stock,bars.slice(0,90),sessions.slice(0,90));
    const low=scanStock(stock,bars.slice(0,95),sessions.slice(0,95),initial.state);
    expect(low.events.filter(e=>e.status==='均線偏低')).toHaveLength(1);
    const leave=scanStock(stock,bars.slice(0,100),sessions.slice(0,100),low.state);
    expect(leave.events.filter(e=>e.status==='離開偏離門檻')).toHaveLength(1);
    for(let i=100;i<105;i++) bars[i]={...bars[i],open:25,high:26,low:24,close:25,rawClose:25};
    const reenter=scanStock(stock,bars.slice(0,105),sessions.slice(0,105),leave.state);
    expect(reenter.events.filter(e=>e.status==='均線偏低')).toHaveLength(1);
  });
  it('expires ranges and waits a cooldown before identifying again',()=>{
    const bars=fixture(180), sessions=bars.map(b=>b.date), first=scanStock(stock,bars.slice(0,70),sessions.slice(0,70));
    const expiry=scanStock(stock,bars.slice(0,131),sessions.slice(0,131),first.state);
    expect(expiry.events.filter(e=>e.status==='區間失效')).toHaveLength(1); expect(expiry.state.range).toBeUndefined();
    const waiting=scanStock(stock,bars.slice(0,135),sessions.slice(0,135),expiry.state);
    expect(waiting.state.range).toBeUndefined();
    expect(scanStock(stock,bars.slice(0,136),sessions.slice(0,136),waiting.state).state.range!.date).toBe(sessions[135]);
  });
});
