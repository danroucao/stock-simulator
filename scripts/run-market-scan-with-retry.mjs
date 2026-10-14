import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const attempts = Math.max(1, Math.min(5, Number(process.env.MARKET_SCAN_ATTEMPTS || 3)));
const delayMs = Math.max(0, Number(process.env.MARKET_SCAN_RETRY_DELAY_MS || 8 * 60 * 1000));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dateInTaipei = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
const minutesInTaipei = (() => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === 'hour')?.value) * 60 + Number(parts.find((part) => part.type === 'minute')?.value);
})();
const expectedFrom = (feed) => {
  const cursor = new Date(`${dateInTaipei}T00:00:00Z`);
  if (minutesInTaipei < 15 * 60 + 30) cursor.setUTCDate(cursor.getUTCDate() - 1);
  const closed = new Set(feed.closedDates || []);
  for (let offset = 0; offset < 366; offset++) {
    const value = cursor.toISOString().slice(0, 10);
    if (![0, 6].includes(cursor.getUTCDay()) && !closed.has(value)) return value;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return null;
};
const run = () => new Promise((resolve) => {
  const child = spawn(process.execPath, ['scripts/scan-market.mjs'], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => resolve(code ?? 1));
  child.on('error', () => resolve(1));
});

const saved = JSON.parse(await readFile('public/market/latest.json', 'utf8'));
if (process.env.GITHUB_EVENT_NAME === 'schedule' && saved.status === 'ready' && saved.date >= expectedFrom(saved)) {
  console.log(`行情 ${saved.date} 已完成，略過同一交易日的後續排程。`);
  process.exit(0);
}

let code = 1;
for (let attempt = 1; attempt <= attempts; attempt++) {
  console.log(`市場資料取得與掃描：第 ${attempt}／${attempts} 次`);
  code = await run();
  if (code === 0) break;
  if (attempt < attempts) {
    const latest = JSON.parse(await readFile('public/alerts/latest.json', 'utf8'));
    console.log(`本次未完成：${latest.message || '資料來源尚未齊全'}。${Math.round(delayMs / 60000)} 分鐘後重試。`);
    await sleep(delayMs);
  }
}
process.exitCode = code;
