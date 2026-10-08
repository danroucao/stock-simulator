const types = ['現股多單', '空單', '融資', '融券'];
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export function validateWorkspaceBackup(raw: string): Record<string, any> {
  const saved = JSON.parse(raw);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.version !== 1) throw new Error('不是支援的工作區備份（版本 1）。');
  if (!/^\d{4,6}$/.test(saved.stockSymbol) || typeof saved.stockName !== 'string') throw new Error('股票資料格式不正確。');
  for (const key of ['availableCash', 'maxRiskPerTrade', 'maxStockWeight', 'feeDiscount']) {
    if (!number(saved[key]) || saved[key] < 0) throw new Error('資金或風險設定格式不正確。');
  }
  if (saved.feeDiscount > 1 || saved.maxStockWeight > 100) throw new Error('折數或比重超出範圍。');
  if (!saved.latestPrices || typeof saved.latestPrices !== 'object' || Array.isArray(saved.latestPrices) || Object.entries(saved.latestPrices).some(([symbol, value]) => !/^\d{4,6}$/.test(symbol) || !number(value) || (value as number) < 0)) throw new Error('行情快取格式不正確。');
  for (const key of ['stockRecords', 'tradePositions', 'presetOrders', 'closedTrades', 'presetFills']) {
    if (key === 'presetFills' && saved[key] === undefined) saved[key] = [];
    if (!Array.isArray(saved[key])) throw new Error(`缺少 ${key} 清單。`);
    const ids = new Set();
    for (const row of saved[key]) {
      if (!row || typeof row !== 'object' || !/^\d{4,6}$/.test(row.symbol)) throw new Error(`${key} 股票代號不正確。`);
      const id = key === 'stockRecords' ? row.symbol : row.id;
      if (typeof id !== 'string' || !id || ids.has(id)) throw new Error(`${key} 有重複或缺漏編號。`);
      ids.add(id);
      if (key === 'stockRecords') {
        if (typeof row.name !== 'string' || !number(row.latestPrice) || row.latestPrice < 0 || !number(row.change) || typeof row.quoteDate !== 'string') throw new Error('股票記錄格式不正確。');
        continue;
      }
      if (!types.includes(row.type) || !Number.isInteger(row.shares) || row.shares <= 0) throw new Error(`${key} 交易類型或股數不正確。`);
      if (key === 'presetFills') {
        if (!number(row.price) || row.price <= 0 || !number(row.plannedPrice) || row.plannedPrice <= 0 || !date(row.date) || typeof row.orderId !== 'string' || !Number.isInteger(row.remainingShares) || row.remainingShares < 0 || !['buy', 'sell'].includes(row.action) || !Number.isFinite(Date.parse(row.recordedAt)) || typeof row.note !== 'string') throw new Error('成交紀錄格式不正確。');
        continue;
      }
      if (!number(row.entryPrice) || row.entryPrice <= 0) throw new Error('進場價格式不正確。');
      for (const field of ['entryFeePaid', 'entryTaxPaid']) if (row[field] !== undefined && (!number(row[field]) || row[field] < 0)) throw new Error('進場費用分攤格式不正確。');
      if (row.shareUnit !== undefined && !['boardLot', 'oddLot'].includes(row.shareUnit)) throw new Error('交易單位格式不正確。');
      for (const field of ['targetPrice', 'stopLossPrice', 'exitPrice']) if (row[field] !== undefined && (!number(row[field]) || row[field] < 0)) throw new Error('價格欄位格式不正確。');
      if (row.note !== undefined && typeof row.note !== 'string') throw new Error('備註格式不正確。');
      if (row.tradeDate !== undefined && !date(row.tradeDate)) throw new Error('持倉日期格式不正確。');
      if (key === 'presetOrders' && (!Number.isFinite(Date.parse(row.createdAt)) || !number(row.validDays) || row.validDays <= 0 || (row.expiryDate && !date(row.expiryDate)) || (row.action && !['buy', 'sell'].includes(row.action)))) throw new Error('預設單日期或方向格式不正確。');
      if (key === 'closedTrades' && (!number(row.exitPrice) || row.exitPrice <= 0 || !number(row.realizedProfit) || !date(row.exitDate))) throw new Error('平倉紀錄格式不正確。');
      if (key === 'closedTrades' && row.tradeDate && row.exitDate < row.tradeDate) throw new Error('平倉日期不可早於入倉日期。');
      if (key === 'closedTrades' && row.costBreakdown !== undefined && (!row.costBreakdown || ['buyFee', 'sellFee', 'transactionTax', 'financingCost', 'borrowCost', 'total'].some(field => !number(row.costBreakdown[field]) || row.costBreakdown[field] < 0))) throw new Error('已實現交易成本快照格式不正確。');
      if (key === 'closedTrades' && row.costAssumptions !== undefined && (!row.costAssumptions || ['feeRate', 'minimumFee', 'taxRate', 'financingLoanRatio', 'feeDiscount', 'financingRate', 'borrowRate', 'holdingDays'].some(field => !number(row.costAssumptions[field]) || row.costAssumptions[field] < 0) || !Number.isFinite(Date.parse(row.costAssumptions.recordedAt)))) throw new Error('歷史成本設定格式不正確。');
      if (key === 'closedTrades' && row.costBreakdown) {
        const costs = row.costBreakdown;
        const total = costs.buyFee + costs.sellFee + costs.transactionTax + costs.financingCost + costs.borrowCost;
        if (Math.abs(total - costs.total) > .01) throw new Error('歷史成本明細與合計不一致。');
        const short = row.type === '空單' || row.type === '融券';
        const gross = (short ? row.entryPrice - row.exitPrice : row.exitPrice - row.entryPrice) * row.shares;
        if (Math.abs(gross - costs.total - row.realizedProfit) > .01) throw new Error('歷史損益與成本快照不一致。');
      }
    }
  }
  if (saved.archivedPresetOrders === undefined) saved.archivedPresetOrders = [];
  if (saved.cashOpeningBalance !== undefined && !number(saved.cashOpeningBalance)) throw new Error('流水起始餘額不正確。');
  if (saved.cashTrackingEnabled !== undefined && typeof saved.cashTrackingEnabled !== 'boolean') throw new Error('流水開關不正確。');
  if (saved.cashMovements !== undefined) {
    if (!Array.isArray(saved.cashMovements)) throw new Error('資金流水格式不正確。');
    const cashIds = new Set();
    for (const movement of saved.cashMovements) {
      if (!movement || typeof movement.id !== 'string' || cashIds.has(movement.id) || !date(movement.date) || !number(movement.amount) || typeof movement.note !== 'string' || !['存入', '支出', '現股買進', '現股賣出'].includes(movement.kind)) throw new Error('資金流水內容不正確。');
      cashIds.add(movement.id);
    }
  }
  if (saved.chartIndicators !== undefined && (!saved.chartIndicators || typeof saved.chartIndicators !== 'object' || ['obv', 'adl', 'histogram'].some(key => typeof saved.chartIndicators[key] !== 'boolean'))) throw new Error('圖表顯示設定格式不正確。');
  if (saved.costModel !== undefined) {
    const costs = saved.costModel;
    if (!costs || typeof costs !== 'object' || ['feeRate', 'minimumFee', 'taxRate', 'financingLoanRatio'].some(key => !number(costs[key]) || costs[key] < 0 || (key !== 'minimumFee' && costs[key] > 1))) throw new Error('成本模型格式不正確。');
  }
  if (saved.priceAlerts === undefined) saved.priceAlerts = {};
  if (!saved.priceAlerts || typeof saved.priceAlerts !== 'object' || Array.isArray(saved.priceAlerts)) throw new Error('價格提醒格式不正確。');
  for (const [symbol, entry] of Object.entries(saved.priceAlerts)) {
    const alert = entry as { lower?: number; upper?: number };
    if (!/^\d{4,6}$/.test(symbol) || !alert || typeof alert !== 'object' || ['lower', 'upper'].some(key => (alert as any)[key] !== undefined && (!number((alert as any)[key]) || (alert as any)[key] <= 0)) || (alert.lower !== undefined && alert.upper !== undefined && alert.lower >= alert.upper)) throw new Error('價格提醒上下限不正確。');
  }
  if (saved.stockIndustries === undefined) saved.stockIndustries = {};
  if (!saved.stockIndustries || typeof saved.stockIndustries !== 'object' || Array.isArray(saved.stockIndustries) || Object.entries(saved.stockIndustries).some(([symbol, label]) => !/^\d{4,6}$/.test(symbol) || typeof label !== 'string' || label.length > 40)) throw new Error('產業分類格式不正確。');
  if (!Array.isArray(saved.archivedPresetOrders)) throw new Error('委託歷史格式不正確。');
  const archivedIds = new Set();
  for (const row of saved.archivedPresetOrders) {
    if (!row || typeof row.id !== 'string' || archivedIds.has(row.id) || !/^\d{4,6}$/.test(row.symbol) || !types.includes(row.type) || !['已成交', '取消'].includes(row.finalStatus) || !number(row.entryPrice) || row.entryPrice <= 0 || !Number.isInteger(row.shares) || row.shares < 0 || !Number.isFinite(Date.parse(row.finalizedAt)) || !Number.isFinite(Date.parse(row.createdAt))) throw new Error('委託歷史內容不正確。');
    archivedIds.add(row.id);
  }
  return saved;
}
