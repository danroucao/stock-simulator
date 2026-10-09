// A bounded, read-only permission probe. Never writes market data or exposes the token.
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const examples = [{ symbol: '2330', market: '上市' }, { symbol: '6182', market: '上櫃' }];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const numericFields = ['open', 'max', 'min', 'close', 'Trading_Volume', 'Trading_money'];
const sanitize = (value, token) => String(value || '').replaceAll(token || '\0', '***').replace(/[\r\n|]/g, ' ').slice(0, 240);

export function inspectRows(data, symbol, startDate, endDate) {
  if (!Array.isArray(data)) return { valid: false, rows: 0, message: '資料不是陣列' };
  const dates = new Set();
  let nonTradingRows = 0;
  for (const row of data) {
    if (row.stock_id !== symbol || !datePattern.test(row.date) || row.date < startDate || row.date > endDate || dates.has(row.date) ||
        !numericFields.every(key => typeof row[key] === 'number' && Number.isFinite(row[key])) || row.Trading_Volume < 0 || row.Trading_money < 0)
      return { valid: false, rows: data.length, message: '股票、日期、重複列或 OHLCV 欄位不符' };
    dates.add(row.date);
    if (row.Trading_Volume === 0 || row.open === 0 || row.close === 0) { nonTradingRows++; continue; }
    if (row.min <= 0 || row.max < Math.max(row.open, row.close, row.min) || row.min > Math.min(row.open, row.close))
      return { valid: false, rows: data.length, message: 'OHLC 價格關係異常' };
  }
  const ordered = [...dates].sort();
  return { valid: data.length > 0, rows: data.length, usableRows: data.length - nonTradingRows, nonTradingRows, firstDate: ordered[0], lastDate: ordered.at(-1) };
}

export function compareRows(raw, adjusted) {
  const byDate = new Map(raw.map(row => [row.date, row]));
  let commonRows = 0, adjustedRows = 0, inconsistentRows = 0;
  for (const row of adjusted) {
    const original = byDate.get(row.date);
    if (!original || [original.open, original.max, original.min, original.close, row.close].some(x => !(x > 0))) continue;
    commonRows++;
    const factor = row.close / original.close;
    if (Math.abs(factor - 1) > 1e-4) adjustedRows++;
    // FinMind rounds adjusted OHLC to cents; allow rounding when comparing factors.
    const tolerance = Math.max(.002, .03 / Math.min(original.open, original.max, original.min, original.close));
    if (['open', 'max', 'min'].some(key => Math.abs(row[key] / original[key] - factor) > tolerance) ||
        row.Trading_Volume !== original.Trading_Volume || row.Trading_money !== original.Trading_money) inconsistentRows++;
  }
  return { commonRows, adjustedRows, inconsistentRows };
}

export async function probeFinMind({ token, fetchImpl = globalThis.fetch, now = new Date() }) {
  const result = { checkedAt: now.toISOString(), tokenConfigured: !!token, requests: 0, endDate: null, checks: [], comparisons: [], singleStockUsable: false };
  if (!token) { result.message = 'GitHub Secret FINMIND_API_TOKEN 未設定'; return result; }
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hourCycle: 'h23' }).format(now));
  async function request(dataset, params = {}) {
    if (++result.requests > 6) throw new Error('Probe request budget exceeded');
    const url = new URL('https://api.finmindtrade.com/api/v4/data');
    url.search = new URLSearchParams({ dataset, ...params }).toString();
    const check = { dataset, symbol: params.data_id || '全市場', http: null, apiStatus: null, accessible: false, message: '' };
    let data = [];
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
      check.http = response.status;
      const body = await response.json();
      check.apiStatus = body.status ?? null;
      check.message = sanitize(body.msg || body.message, token);
      check.accessible = response.ok && (body.status === undefined || body.status === 200) && Array.isArray(body.data) && body.data.length > 0;
      if (Array.isArray(body.data)) data = body.data;
    } catch { check.message = '請求逾時、連線失敗或回應不是 JSON'; }
    result.checks.push(check);
    return { check, data };
  }
  const calendar = await request('TaiwanStockTradingDate');
  if (!calendar.check.accessible) { result.message = '交易日曆讀取失敗，不能確認行情交易日'; return result; }
  const sessions = [...new Set(calendar.data.map(row => row.date))].filter(date => datePattern.test(date) && (date < today || date === today && hour >= 19)).sort();
  const endDate = sessions.at(-1);
  if (!endDate) { result.message = '交易日曆無可用日期'; return result; }
  result.endDate = endDate;
  const startDate = new Date(`${endDate}T00:00:00Z`); startDate.setUTCDate(startDate.getUTCDate() - 220);
  const start = startDate.toISOString().slice(0, 10);
  for (const example of examples) {
    const params = { data_id: example.symbol, start_date: start, end_date: endDate };
    const raw = await request('TaiwanStockPrice', params);
    const adjusted = await request('TaiwanStockPriceAdj', params);
    raw.check.validation = inspectRows(raw.data, example.symbol, start, endDate);
    adjusted.check.validation = inspectRows(adjusted.data, example.symbol, start, endDate);
    const comparison = raw.check.accessible && adjusted.check.accessible && raw.check.validation.valid && adjusted.check.validation.valid
      ? compareRows(raw.data, adjusted.data) : { commonRows: 0, adjustedRows: 0, inconsistentRows: 0 };
    const expectedSessions = sessions.filter(date => date >= start && date <= endDate).slice(-70);
    const actualDates = rows => rows.map(row => row.date).sort().slice(-70);
    const complete = expectedSessions.length === 70 && JSON.stringify(actualDates(raw.data)) === JSON.stringify(expectedSessions) && JSON.stringify(actualDates(adjusted.data)) === JSON.stringify(expectedSessions);
    result.comparisons.push({ ...example, ...comparison, completeRecent70Sessions: complete,
      usable: raw.check.accessible && adjusted.check.accessible && raw.check.validation.valid && adjusted.check.validation.valid &&
        comparison.commonRows >= 70 && comparison.inconsistentRows === 0 && complete });
  }
  // Same dataset without data_id is the control for the already-observed bulk restriction.
  await request('TaiwanStockPriceAdj', { start_date: endDate, end_date: endDate });
  result.singleStockUsable = result.comparisons.length === examples.length && result.comparisons.every(check => check.usable);
  result.message = result.singleStockUsable ? '上市／上櫃單檔還原行情可用；仍需另做全市場分批、配額與快取設計' :
    '單檔還原行情未通過，請依各端點回應區分權限不足與資料品質問題';
  return result;
}

export function formatReport(result) {
  const lines = ['## FinMind 單檔還原行情驗證', `驗證時間（UTC）：${result.checkedAt}`, `行情交易日：${result.endDate || '無法確認'}`,
    `密鑰已設定：${result.tokenConfigured ? '是' : '否'}；實際請求：${result.requests} 次（最多 6 次）`, '',
    '| 股票 | 資料集 | HTTP | API | 有權存取 | 筆數 | 診斷 |', '|---|---|---:|---:|---|---:|---|'];
  for (const check of result.checks) lines.push(`| ${check.symbol} | ${check.dataset} | ${check.http ?? '—'} | ${check.apiStatus ?? '—'} | ${check.accessible ? '是' : '否'} | ${check.validation?.rows ?? '—'} | ${check.message} |`);
  for (const comparison of result.comparisons) lines.push(`\n${comparison.symbol}（${comparison.market}）：共同日期 ${comparison.commonRows} 筆；有調整 ${comparison.adjustedRows} 筆；價格／量值不一致 ${comparison.inconsistentRows} 筆；近 70 交易日完整：${comparison.completeRecent70Sessions ? '是' : '否'}。`);
  lines.push('', `結果：${result.message}`, '', '只測試讀取權限與資料完整性，沒有執行全市場掃描、寫入市場結果或部署網站。');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await probeFinMind({ token: process.env.FINMIND_API_TOKEN });
  const report = formatReport(result);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
  // A denial is a valid diagnostic result, not a malfunction of the probe workflow.
  if (!result.tokenConfigured || !result.endDate) process.exitCode = 1;
}
