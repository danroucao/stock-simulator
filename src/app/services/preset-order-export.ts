import { PresetOrder, PresetFill, TradeCostBreakdown } from '../models/trade-position.model';
import { PortfolioCalculatorService } from './portfolio-calculator.service';
import { estimatePlan, pendingOrderStatus } from './order-planning';

export interface ExportCostContext {
  calculator: PortfolioCalculatorService; discount: number; financingRate: number; borrowRate: number; asOf: string;
  estimateSell?: (order: PresetOrder) => number | null;
  salePlan?: (order: PresetOrder) => {gross:number;net:number;costs:TradeCostBreakdown} | null;
}

export async function buildFillHistoryWorkbook(fills: PresetFill[], names: Record<string, string>) {
  const loaded=await import('exceljs');
  const {Workbook}=loaded.default ?? loaded;
  const book = new Workbook();
  book.creator = 'Stock Trading Simulator';
  book.created = new Date();
  const sheet = book.addWorksheet('實際成交紀錄');
  sheet.columns = [['成交日期', 14], ['股票代號', 12], ['名稱', 16], ['方向', 10], ['交易方式', 12], ['原委託價', 14], ['成交價', 14], ['成交股數', 14], ['成交金額', 18], ['價差（成交－委託）', 22], ['本次後剩餘股數', 20], ['原單編號', 34], ['紀錄時間（台北）', 26], ['備註', 30]].map(([header, width]) => ({ header: String(header), width: Number(width) }));
  const sorted = [...fills].sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt));
  for (const fill of sorted) {
    const row = sheet.addRow([fill.date, fill.symbol, names[fill.symbol] || '', fill.action === 'sell' ? '賣出' : '買進', fill.type, fill.plannedPrice, fill.price, fill.shares, null, null, fill.remainingShares, fill.orderId,
      new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(fill.recordedAt)), fill.note]);
    row.getCell(9).value = { formula: `G${row.number}*H${row.number}`, result: fill.price * fill.shares };
    row.getCell(10).value = { formula: `G${row.number}-F${row.number}`, result: fill.price - fill.plannedPrice };
    for (const col of [6, 7, 9, 10]) row.getCell(col).numFmt = '#,##0.00;[Red]-#,##0.00';
    for (const col of [8, 11]) row.getCell(col).numFmt = '#,##0';
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `N${Math.max(sheet.rowCount, 1)}` };
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17324D' } };
  });
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  const help = book.addWorksheet('使用說明');
  help.getColumn(1).width = 110;
  help.addRow(['僅含所選範圍內手動確認的成交；每次部分成交獨立一列。']);
  help.addRow(['成交金額未含交易成本；成交與委託的價差不是損益。持倉及已平倉損益請回網站查看。']);
  help.addRow(['本次後剩餘股數是該次成交時的快照，後續成交或取消不會改寫此值。']);
  return book;
}

export async function buildPresetOrderWorkbook(orders: PresetOrder[], names: Record<string, string>, filterDescription = '全部記錄', context?: ExportCostContext) {
  const loaded=await import('exceljs');
  const {Workbook}=loaded.default ?? loaded;
  const book = new Workbook();
  book.creator = 'Stock Trading Simulator';
  book.created = new Date();
  const detail = book.addWorksheet('預設單明細');
  detail.columns = [
    ['建立日期', 14], ['有效至', 14], ['股票代號', 12], ['名稱', 16], ['方向', 10], ['交易方式', 12],
    ['單位', 10], ['委託價', 12], ['股數', 12], ['委託金額', 18], ['目標出場價', 14], ['停損價', 12],
    ['價差損益（未扣成本）', 24], ['狀態（自行記錄）', 20], ['成交價（自行記錄）', 20], ['備註（自行記錄）', 30],
    ['預計交易日', 16], ['預估持有天數（日曆日）', 24], ['買進手續費（元）', 22], ['賣出手續費（元）', 22],
    ['交易稅（元）', 18], ['融資／融券成本（元）', 24], ['預估淨損益（元）', 22], ['手續費率', 16], ['折數', 12],
    ['最低手續費（元）', 22], ['交易稅率', 16], ['融資年率（%）', 20], ['融券年率（%）', 20], ['網站狀態', 20],
  ].map(([header, width]) => ({ header: String(header), width: Number(width) }));
  const sorted = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.symbol.localeCompare(b.symbol) || a.entryPrice - b.entryPrice);
  const estimates = new Map(sorted.map(order => [order.id, context ? estimatePlan({ entry: order.entryPrice, shares: order.shares, type: order.type,
    target: order.exitPrice, stop: order.stopLossPrice, days: order.estimatedHoldingDays ?? order.validDays,
    discount: context.discount, financingRate: context.financingRate, borrowRate: context.borrowRate }, context.calculator) : null]));
  const netEstimates = new Map<string,number|null>();
  for (const order of sorted) {
    const plan = estimates.get(order.id), sale = order.action === 'sell' ? context?.salePlan?.(order) : null,
      costs = order.action === 'sell' ? sale?.costs : plan?.costs;
    const settings = context?.calculator.costSettings();
    const net = order.action === 'sell' ? sale?.net ?? context?.estimateSell?.(order) ?? null : plan?.reward ?? null;
    netEstimates.set(order.id,net);
    const row = detail.addRow([
      order.createdAt.includes('T') ? new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Taipei' }).format(new Date(order.createdAt)) : order.createdAt.slice(0, 10), order.expiryDate || '', order.symbol, names[order.symbol] || '',
      order.action === 'sell' ? '賣出' : '買進', order.type,
      order.shareUnit === 'oddLot' ? '零股' : '整張', order.entryPrice, order.shares, null,
      order.exitPrice ?? null, order.stopLossPrice ?? null, null, '待確認', null, order.note ?? '',
      order.plannedTradeDate ?? '未設定（舊單）', order.action === 'sell' ? '按持倉截至匯出日' : order.estimatedHoldingDays ?? order.validDays,
      costs?.buyFee ?? null, costs?.sellFee ?? null, costs?.transactionTax ?? null,
      costs ? costs.financingCost + costs.borrowCost : null, net,
      settings?.feeRate ?? null, context?.discount ?? null, settings?.minimumFee ?? null, settings?.taxRate ?? null,
      context?.financingRate ?? null, context?.borrowRate ?? null, context ? pendingOrderStatus(order, context.asOf, false) : '未判定',
    ]);
    const r = row.number;
    if (sale) row.getCell(13).value = sale.gross;
    row.getCell(10).value = { formula: `H${r}*I${r}`, result: order.entryPrice * order.shares };
    if (order.action !== 'sell' && Number.isFinite(order.entryPrice) && order.entryPrice > 0 && Number.isInteger(order.shares) && order.shares > 0 && order.exitPrice !== undefined && Number.isFinite(order.exitPrice) && order.exitPrice > 0) {
      const sign = order.type === '空單' || order.type === '融券' ? -1 : 1;
      row.getCell(13).value = { formula: `(K${r}-H${r})*I${r}*${sign}`, result: (order.exitPrice - order.entryPrice) * order.shares * sign };
    }
    for (const col of [8, 10, 11, 12, 13, 15]) row.getCell(col).numFmt = '#,##0.00;[Red]-#,##0.00';
    for (const col of [19,20,21,22,23,26]) row.getCell(col).numFmt = '#,##0.00;[Red]-#,##0.00';
    for (const col of [24,27]) row.getCell(col).numFmt = '0.0000%';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(5).font = { bold: true, color: { argb: order.action === 'sell' ? 'FF15803D' : 'FFDC2626' } };
    row.getCell(14).dataValidation = { type: 'list', allowBlank: true, formulae: ['"待確認,已掛單,部分成交,已成交,取消,過期"'] };
  }
  const summary = book.addWorksheet('布局總覽');
  summary.columns = [['股票代號', 14], ['名稱', 18], ['價位筆數', 12], ['買進股數', 16], ['買進委託金額', 20], ['賣出股數', 16], ['賣出委託金額', 20]].map(([header, width]) => ({ header: String(header), width: Number(width) }));
  summary.columns = [...summary.columns.map(column => ({header: column.header, width: column.width})),
    ...[['買進目標價差合計（元）',24],['買進預估成本合計（元）',24],['預估淨損益合計（元）',24],['淨損益無法計算筆數',24]].map(([header,width])=>({header:String(header),width:Number(width)}))];
  for (const symbol of [...new Set(sorted.map(order => order.symbol))]) {
    const group = sorted.filter(order => order.symbol === symbol);
    const buys = group.filter(order => order.action !== 'sell');
    const sells = group.filter(order => order.action === 'sell');
    const nets = group.map(order => netEstimates.get(order.id) ?? null);
    const missing = nets.filter(value => value === null).length;
    const buyPlans = buys.map(order => estimates.get(order.id));
    summary.addRow([symbol, names[symbol] || '', group.length,
      buys.reduce((n, o) => n + o.shares, 0), buys.reduce((n, o) => n + o.shares * o.entryPrice, 0),
      sells.reduce((n, o) => n + o.shares, 0), sells.reduce((n, o) => n + o.shares * o.entryPrice, 0),
      buyPlans.every(plan=>plan?.gross!==null && plan?.gross!==undefined) ? buyPlans.reduce((sum,p)=>sum+p!.gross!,0) : null,
      buyPlans.every(plan=>!!plan?.costs) ? buyPlans.reduce((sum,p)=>sum+p!.costs!.total,0) : null,
      missing ? null : nets.reduce<number>((sum,value)=>sum+value!,0), missing]);
  }
  const help = book.addWorksheet('使用說明');
  help.getColumn(1).width = 110;
  [
    `匯出範圍：${filterDescription}`,
    '預設單規劃表：每個委託價位獨立一列，同日同股票可保留多筆。',
    '建立日期是記錄日期；預計交易日是使用者指定日期，與有效至、實際成交日期分開。舊單未設定交易日不推測。',
    '委託金額＝委託價×股數；均為新台幣，未含手續費、稅費、融資利息及保證金規則。',
    '目標價差損益以委託價到目標出場價計算；空單／融券反向計算。賣出委託不是已實現損益。',
    `成本假設截至 ${context?.asOf ?? '未提供'}；費率、折數、最低費與年率明列於明細。預估持有天數是日曆日，不是委託有效期限。`,
    '價差損益未扣成本；預估淨損益扣除手續費、交易稅及融資／融券估費。網站金額取整元；Excel 保留完整計算值、顯示小數二位，不逐項先四捨五入。',
    '淨損益空白代表無法計算；總覽若有未知淨損益，合計留空並列缺漏筆數。賣出單淨損益從網站現有持倉起算，非委託價至目標的價差。',
    '賣出單按同股票、同類型持倉先進先出估算，費用欄包含已記錄進場費的分攤；持有天數截至匯出日，不用新單的預估持有天數。持倉不足時不計算部分損益。',
    '布局總覽是匯出當下範圍的快照，修改明細後請重新匯出以更新總覽。未設定有效日期的記錄仍會保留。',
    '狀態、成交價、備註由投資者自行記錄；本檔不會自動下單或回寫網站。',
  ].forEach(text => help.addRow([text]));
  for (const sheet of [detail, summary]) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(sheet.rowCount, 1), column: sheet.columnCount } };
    sheet.getRow(1).height = 28;
    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17324D' } };
    });
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  return book;
}
