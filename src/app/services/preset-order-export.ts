import { PresetOrder, PresetFill } from '../models/trade-position.model';

export async function buildFillHistoryWorkbook(fills: PresetFill[], names: Record<string, string>) {
  const { Workbook } = await import('exceljs');
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

export async function buildPresetOrderWorkbook(orders: PresetOrder[], names: Record<string, string>, filterDescription = '全部記錄') {
  const { Workbook } = await import('exceljs');
  const book = new Workbook();
  book.creator = 'Stock Trading Simulator';
  book.created = new Date();
  const detail = book.addWorksheet('預設單明細');
  detail.columns = [
    ['建立日期', 14], ['有效至', 14], ['股票代號', 12], ['名稱', 16], ['方向', 10], ['交易方式', 12],
    ['單位', 10], ['委託價', 12], ['股數', 12], ['委託金額', 18], ['目標出場價', 14], ['停損價', 12],
    ['目標價差損益', 18], ['狀態（自行記錄）', 20], ['成交價（自行記錄）', 20], ['備註（自行記錄）', 30],
  ].map(([header, width]) => ({ header: String(header), width: Number(width) }));
  const sorted = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.symbol.localeCompare(b.symbol) || a.entryPrice - b.entryPrice);
  for (const order of sorted) {
    const row = detail.addRow([
      order.createdAt.slice(0, 10), order.expiryDate || '', order.symbol, names[order.symbol] || '',
      order.action === 'sell' ? '賣出' : '買進', order.type,
      order.shareUnit === 'oddLot' ? '零股' : '整張', order.entryPrice, order.shares, null,
      order.exitPrice ?? null, order.stopLossPrice ?? null, null, '待確認', null, order.note ?? '',
    ]);
    const r = row.number;
    row.getCell(10).value = { formula: `H${r}*I${r}`, result: order.entryPrice * order.shares };
    if (order.exitPrice !== undefined) {
      const sign = order.type === '空單' || order.type === '融券' ? -1 : 1;
      row.getCell(13).value = { formula: `(K${r}-H${r})*I${r}*${sign}`, result: (order.exitPrice - order.entryPrice) * order.shares * sign };
    }
    for (const col of [8, 10, 11, 12, 13, 15]) row.getCell(col).numFmt = '#,##0.00;[Red]-#,##0.00';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(5).font = { bold: true, color: { argb: order.action === 'sell' ? 'FF15803D' : 'FFDC2626' } };
    row.getCell(14).dataValidation = { type: 'list', allowBlank: true, formulae: ['"待確認,已掛單,部分成交,已成交,取消,過期"'] };
  }
  const summary = book.addWorksheet('布局總覽');
  summary.columns = [['股票代號', 14], ['名稱', 18], ['價位筆數', 12], ['買進股數', 16], ['買進委託金額', 20], ['賣出股數', 16], ['賣出委託金額', 20]].map(([header, width]) => ({ header: String(header), width: Number(width) }));
  for (const symbol of [...new Set(sorted.map(order => order.symbol))]) {
    const group = sorted.filter(order => order.symbol === symbol);
    const buys = group.filter(order => order.action !== 'sell');
    const sells = group.filter(order => order.action === 'sell');
    summary.addRow([symbol, names[symbol] || '', group.length,
      buys.reduce((n, o) => n + o.shares, 0), buys.reduce((n, o) => n + o.shares * o.entryPrice, 0),
      sells.reduce((n, o) => n + o.shares, 0), sells.reduce((n, o) => n + o.shares * o.entryPrice, 0)]);
  }
  const help = book.addWorksheet('使用說明');
  help.getColumn(1).width = 110;
  [
    `匯出範圍：${filterDescription}`,
    '預設單規劃表：每個委託價位獨立一列，同日同股票可保留多筆。',
    '建立日期是記錄建立日期，不是指定下單日或成交日。有效至空白表示原記錄未提供日期。',
    '委託金額＝委託價×股數；均為新台幣，未含手續費、稅費、融資利息及保證金規則。',
    '目標價差損益以委託價到目標出場價計算；空單／融券反向計算。賣出委託不是已實現損益。',
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
