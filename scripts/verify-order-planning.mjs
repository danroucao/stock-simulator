// Isolated browser storage and explicitly entered test orders. No broker requests.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});await mkdir('tmp',{recursive:true});
const base=process.env.WORKSPACE_TEST_URL||'http://127.0.0.1:4200/';
// Explicit test clock; never changes the published market data or operating system clock.
const today='2026-10-14';
let activePage;
try {for(const width of [1280,390]) {
 const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
 activePage=page;
 await page.clock.setFixedTime('2026-10-14T03:00:00Z');
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://www.twse.com.tw/**',r=>r.abort());await page.route('**/api/**',r=>r.abort());
 await page.goto(base+'#/stock/2353?tab=trade');await page.getByRole('tab',{name:'交易規劃',exact:true}).click();
 await page.getByRole('button',{name:'建立部位',exact:true}).click();const form=page.locator('.board-form');
 const waitResult=(label,unknown)=>page.waitForFunction(({label,unknown})=>{
   const value=[...document.querySelectorAll('.order-risk-card > div')].find(el=>el.querySelector('span')?.textContent===label)?.querySelector('strong')?.textContent.trim();
   return !!value && (unknown ? value==='無法計算' : value!=='無法計算');
 },{label,unknown});
 await form.getByLabel('委託價',{exact:true}).fill('0');await form.getByLabel('預計出場價（選填）',{exact:true}).fill('112');
 await waitResult('目標預估淨損益',true);
 const reward=form.locator('.order-risk-card > div').filter({hasText:'目標預估淨損益'});
 assert.ok((await reward.textContent()).includes('無法計算'));
 await form.getByLabel('委託價',{exact:true}).fill('100');await form.getByLabel('停損價（選填）',{exact:true}).fill('');
 await waitResult('目標預估淨損益',false);await waitResult('風險報酬比',true);
 assert.ok((await form.locator('.order-risk-card > div').filter({hasText:'風險報酬比'}).textContent()).includes('無法計算'));
 await form.getByLabel('股數',{exact:true}).fill('0');await waitResult('目標預估淨損益',true);assert.ok((await reward.textContent()).includes('無法計算'));
 await form.getByLabel('股數',{exact:true}).fill('1000');await form.getByLabel('停損價（選填）',{exact:true}).fill('95');
 await form.getByLabel('預計交易日',{exact:true}).fill(today);await form.getByLabel('有效至',{exact:true}).fill(today);await form.getByLabel('預估持有天數',{exact:true}).fill('12');
 await waitResult('目標預估淨損益',false);
 const expectedText=(await reward.locator('strong').textContent()).trim();
 await form.getByRole('button',{name:'建立買進委託',exact:true}).dblclick();await page.locator('.preset-order-row').waitFor();assert.equal(await page.locator('.preset-order-row').count(),1);
 assert.ok((await page.locator('.preset-order-row').textContent()).includes(expectedText));
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('stock-simulator-workspace-v1')));assert.equal(stored.presetOrders.length,1);assert.equal(stored.presetOrders[0].plannedTradeDate,today);assert.equal(stored.presetOrders[0].estimatedHoldingDays,12);
 await page.reload();await page.locator('.preset-order-row').waitFor();assert.equal(await page.locator('.preset-order-row').count(),1);
 await page.getByText('待成交委託 Excel 匯出',{exact:false}).first().click();
 await page.getByLabel('匯出預計交易日',{exact:true}).fill(today);
 const promise=page.waitForEvent('download');await page.getByRole('button',{name:/^匯出 Excel/}).click();const download=await promise;
 const book=new ExcelJS.Workbook();await book.xlsx.readFile(await download.path());const sheet=book.getWorksheet('預設單明細'),summary=book.getWorksheet('布局總覽');
 assert.equal(sheet.getCell('Q2').value,today);assert.equal(sheet.getCell('M2').value.result,12000);assert.equal(sheet.getCell('R2').value,12);
 assert.equal(sheet.getCell('W2').value,summary.getCell('J2').value);assert.equal(sheet.getCell('Y2').value,.6);
 await page.screenshot({path:'tmp/order-planning-'+width+'.png'});assert.deepEqual(errors,[]);await context.close();
 console.log(width+'px: invalid inputs, missing stop, form/card consistency, double-click prevention, immediate persistence/reload and dated Excel gross/net passed.');
}} catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:'tmp/order-planning-failure.png'});throw error;} finally {await browser.close();}
