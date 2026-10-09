import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
  await context.route('**/api/tpex/**', route => route.fulfill({ json: { msgArray: [{ c: '2330', n: '台積電', d: today.replaceAll('-', ''), z: '100', y: '99', o: '99', h: '105', l: '95', v: '100' }] } }));
  await context.route('https://www.twse.com.tw/**', route => route.fulfill({ json: { title: '2330 台積電', data: [['115/09/01', '10000', '1000000', '99', '105', '95', '100', '1', '100', '0']] } }));
  const left = await context.newPage();
  await left.goto('http://localhost:4200');
  await left.waitForFunction(() => document.querySelector('.summary-item.accent strong')?.textContent.includes('台積電'));
  await left.locator('#workspace-settings > details > summary').evaluate(el => el.parentElement.open = true);
  await left.getByRole('button', { name: '立即儲存', exact: true }).click();
  const right = await context.newPage();
  await right.goto('http://localhost:4200');
  await right.waitForFunction(() => document.querySelector('.summary-item.accent strong')?.textContent.includes('台積電'));

  await left.getByLabel('可用現金', { exact: true }).fill('123456');
  await left.getByRole('button', { name: '立即儲存', exact: true }).click();
  await right.getByText('另一分頁已修改工作區，自動儲存已暫停', { exact: true }).waitFor();
  await right.locator('#workspace-settings > details > summary').click();
  await right.getByLabel('可用現金', { exact: true }).fill('654321');
  await right.getByRole('button', { name: '立即儲存', exact: true }).click();
  assert.equal(await right.evaluate(() => JSON.parse(localStorage.getItem('stock-simulator-workspace-v1')).availableCash), 123456);
  await right.getByRole('button', { name: '採用另一分頁資料', exact: true }).click();
  await right.waitForFunction(() => [...document.querySelectorAll('label')].some(label => label.textContent.trim() === '可用現金' && label.querySelector('input')?.value === '123456'));
  await right.getByText('交易成本模型（自訂假設）', { exact: true }).click();
  await right.getByLabel('融資年利率（%）', { exact: true }).fill('6.7');
  await right.getByLabel('融資年利率（%）', { exact: true }).press('Tab');
  await right.getByLabel('融券年費率（%）', { exact: true }).fill('2.1');
  await right.getByLabel('融券年費率（%）', { exact: true }).press('Tab');
  await right.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('stock-simulator-workspace-v1'));
    return saved.financingRate === 6.7 && saved.shortBorrowRate === 2.1;
  });
  await right.reload();
  await right.locator('#workspace-settings > details > summary').click();
  await right.getByText('交易成本模型（自訂假設）', { exact: true }).click();
  assert.equal(await right.getByLabel('融資年利率（%）', { exact: true }).inputValue(), '6.7');
  assert.equal(await right.getByLabel('融券年費率（%）', { exact: true }).inputValue(), '2.1');
  console.log('Verified: shared browser tabs detect conflict, block overwrite, and reload chosen workspace');
} finally { await browser.close(); }
