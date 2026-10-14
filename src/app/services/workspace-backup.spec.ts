import { validateWorkspaceBackup } from './workspace-backup';

function backup() {
  return { version: 1, stockSymbol: '2330', stockName: '台積電', availableCash: 100000, maxRiskPerTrade: 1000,
    maxStockWeight: 25, feeDiscount: .6, latestPrices: {}, stockRecords: [], presetOrders: [], closedTrades: [],
    tradePositions: [{ id: 'position', symbol: '2330', type: '現股多單', shares: 100, entryPrice: 100, targetPrice: 110, tradeDate: '2026-02-01', note: '' }] };
}
describe('workspace backup validation', () => {
  it('preserves independent order dates and rejects inverted dates without inventing dates for old orders', () => {
    const order={id:'test',symbol:'2353',type:'現股多單',shares:1000,entryPrice:100,createdAt:'2026-10-14',expiryDate:'2026-10-16',plannedTradeDate:'2026-10-15',estimatedHoldingDays:12,validDays:5};
    const data={...backup(),presetOrders:[order]};
    expect(validateWorkspaceBackup(JSON.stringify(data))['presetOrders'][0].estimatedHoldingDays).toBe(12);
    expect(()=>validateWorkspaceBackup(JSON.stringify({...data,presetOrders:[{...order,plannedTradeDate:'2026-10-17'}]}))).toThrow('預計交易日');
    const old={...order,plannedTradeDate:undefined,estimatedHoldingDays:undefined};
    expect(validateWorkspaceBackup(JSON.stringify({...data,presetOrders:[old]}))['presetOrders'][0].plannedTradeDate).toBeUndefined();
  });
  it('preserves optional interest rates and rejects invalid values', () => {
    const data = { ...backup(), financingRate: 6.7, shortBorrowRate: 2.1 };
    expect(validateWorkspaceBackup(JSON.stringify(data))['financingRate']).toBe(6.7);
    expect(validateWorkspaceBackup(JSON.stringify(data))['shortBorrowRate']).toBe(2.1);
    expect(() => validateWorkspaceBackup(JSON.stringify({ ...data, financingRate: -1 }))).toThrow('年費率');
    expect(() => validateWorkspaceBackup(JSON.stringify({ ...data, shortBorrowRate: '2.1' }))).toThrow('年費率');
  });
  it('accepts legacy backups and supplies empty optional collections', () => {
    const result = validateWorkspaceBackup(JSON.stringify(backup()));
    expect(result['presetFills']).toEqual([]);
    expect(result['archivedPresetOrders']).toEqual([]);
  });
  it('rejects calendar rollover dates rather than accepting Date.parse normalization', () => {
    const data = backup();
    data.tradePositions[0].tradeDate = '2026-02-30';
    expect(() => validateWorkspaceBackup(JSON.stringify(data))).toThrow('日期');
    data.tradePositions[0].tradeDate = '2024-02-29';
    expect(() => validateWorkspaceBackup(JSON.stringify(data))).not.toThrow();
  });
  it('rejects duplicate holding ids', () => {
    const data = backup();
    data.tradePositions.push({ ...data.tradePositions[0] });
    expect(() => validateWorkspaceBackup(JSON.stringify(data))).toThrow('重複');
  });
  it('rejects a cost snapshot whose total does not match its components', () => {
    const data: any = backup();
    data.closedTrades = [{ ...data.tradePositions[0], id: 'closed', exitPrice: 110, exitDate: '2026-02-02', realizedProfit: 950,
      costBreakdown: { buyFee: 10, sellFee: 10, transactionTax: 30, financingCost: 0, borrowCost: 0, total: 60 } }];
    expect(() => validateWorkspaceBackup(JSON.stringify(data))).toThrow('合計');
    data.closedTrades[0].costBreakdown.total = 50;
    expect(() => validateWorkspaceBackup(JSON.stringify(data))).not.toThrow();
    data.closedTrades[0].realizedProfit = 900;
    expect(() => validateWorkspaceBackup(JSON.stringify(data))).toThrow('損益');
  });
});
