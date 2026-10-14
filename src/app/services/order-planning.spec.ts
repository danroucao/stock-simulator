import { estimatePlan, plannedDateError, pendingOrderStatus } from './order-planning';
import { PortfolioCalculatorService } from './portfolio-calculator.service';
import { buildPresetOrderWorkbook } from './preset-order-export';
import { PresetOrder } from '../models/trade-position.model';

describe('trade planning contracts', () => {
  const input = {entry:100,target:112,stop:95,shares:1000,type:'現股多單' as const,days:5,discount:.6,financingRate:4.5,borrowRate:3.2};
  it('shares one discounted cost model and keeps the correct 12000 gross amount', () => {
    const calculator = new PortfolioCalculatorService(), p = estimatePlan(input, calculator)!;
    expect(p.gross).toBe(12000);
    expect(p.reward).toBeCloseTo(12000 - (100000+112000)*.001425*.6 - 112000*.003);
    expect(p.reward).toBe(calculator.simulateOrder(100,112,'現股多單',1000,5,4.5,3.2,.6));
  });
  it('blocks zero, nonfinite and fractional financial inputs', () => {
    const calculator = new PortfolioCalculatorService();
    for (const bad of [{entry:0},{entry:Infinity},{shares:0},{shares:1.2},{shares:NaN},{days:0},{discount:1.2}]) expect(estimatePlan({...input,...bad},calculator)).toBeNull();
  });
  it('does not invent risk or reward when optional prices are absent', () => {
    const p=estimatePlan({...input,target:undefined,stop:undefined},new PortfolioCalculatorService())!;
    expect(p.risk).toBeNull();expect(p.reward).toBeNull();expect(p.ratio).toBeNull();
  });
  it('validates stop and target directions for every long and short instrument', () => {
    const c=new PortfolioCalculatorService();
    for(const type of ['現股多單','融資'] as const) expect(estimatePlan({...input,type,stop:105},c)).toBeNull();
    for(const type of ['空單','融券'] as const) {
      expect(estimatePlan({...input,type,stop:105,target:90},c)?.reward).toBeGreaterThan(0);
      expect(estimatePlan({...input,type,stop:95,target:90},c)).toBeNull();
      expect(estimatePlan({...input,type,stop:105,target:110},c)).toBeNull();
    }
  });
  it('allows equal planned and expiry dates and rejects impossible dates', () => {
    expect(plannedDateError('2026-10-14','2026-10-14')).toBe('');
    expect(plannedDateError('2026-10-15','2026-10-14')).toContain('不可晚於');
    expect(plannedDateError('2026-02-30','2026-10-14')).toContain('有效');
  });
  const order:PresetOrder={id:'isolated-test',symbol:'2353',type:'現股多單',entryPrice:100,exitPrice:112,shares:1000,validDays:5,estimatedHoldingDays:5,createdAt:'2026-10-13T16:00:00Z',plannedTradeDate:'2026-10-15',expiryDate:'2026-10-16'};
  it('distinguishes future, pending, partial and expired with expiry precedence', () => {
    expect(pendingOrderStatus(order,'2026-10-14',false)).toBe('尚未到交易日');
    expect(pendingOrderStatus(order,'2026-10-15',false)).toBe('待成交');
    expect(pendingOrderStatus(order,'2026-10-15',true)).toBe('部分成交');
    expect(pendingOrderStatus(order,'2026-10-17',true)).toBe('已過期');
    expect(pendingOrderStatus({...order,plannedTradeDate:undefined},'2026-10-14',false)).toBe('待成交');
  });
  it('exports gross/net and assumptions without moving the existing gross column', async () => {
    const calculator=new PortfolioCalculatorService();
    const book=await buildPresetOrderWorkbook([order,{...order,id:'second',shares:2000}],{},'isolated tests',{calculator,discount:.6,financingRate:4.5,borrowRate:3.2,asOf:'2026-10-14'});
    const detail=book.getWorksheet('預設單明細')!,summary=book.getWorksheet('布局總覽')!;
    expect(detail.getCell('M2').value).toEqual({formula:'(K2-H2)*I2*1',result:12000});
    expect(detail.getCell('Q2').value).toBe('2026-10-15');
    expect(detail.getCell('W2').value).toBe(estimatePlan(input,calculator)!.reward);
    expect(detail.getCell('Y2').value).toBe(.6);
    expect(summary.getCell('H2').value).toBe(36000);
    expect(summary.getCell('J2').value).toBeCloseTo((detail.getCell('W2').value as number)+(detail.getCell('W3').value as number));
  });
  it('leaves aggregate net unknown instead of dropping a row with no target', async () => {
    const calculator=new PortfolioCalculatorService();
    const book=await buildPresetOrderWorkbook([order,{...order,id:'unknown',exitPrice:undefined}],{},'tests',{calculator,discount:.6,financingRate:0,borrowRate:0,asOf:'2026-10-14'});
    expect(book.getWorksheet('布局總覽')!.getCell('J2').value).toBeNull();
    expect(book.getWorksheet('布局總覽')!.getCell('K2').value).toBe(1);
  });
  it('exports sale costs from the actual holdings basis rather than treating a sale as a new round trip', async () => {
    const calculator=new PortfolioCalculatorService(),costs={buyFee:20,sellFee:40,transactionTax:100,financingCost:5,borrowCost:0,total:165};
    const book=await buildPresetOrderWorkbook([{...order,action:'sell'}],{},'tests',{calculator,discount:.6,financingRate:4.5,borrowRate:3.2,asOf:'2026-10-14',salePlan:()=>({gross:12000,costs,net:11835})});
    const detail=book.getWorksheet('預設單明細')!;
    expect(detail.getCell('M2').value).toBe(12000);expect(detail.getCell('S2').value).toBe(20);expect(detail.getCell('W2').value).toBe(11835);
    expect(detail.getCell('R2').value).toBe('按持倉截至匯出日');expect(book.getWorksheet('布局總覽')!.getCell('J2').value).toBe(11835);
  });
});
