// Read-only real-data checks. Browser storage is isolated and no orders are submitted.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  await page.route('https://www.twse.com.tw/**',r=>r.abort());await page.route('**/api/**',r=>r.abort());
  await page.route('**/alerts/history.json?**',async r=>{await new Promise(resolve=>setTimeout(resolve,500));await r.continue();});
  await page.goto(process.env.ALERT_TEST_URL || 'http://127.0.0.1:4200');await page.getByRole('link',{name:'提醒中心',exact:true}).click();
  const center=page.locator('app-alert-center');await center.locator('tbody tr').first().waitFor();
  const waitRows=n=>page.waitForFunction(n=>document.querySelectorAll('app-alert-center tbody tr').length===n,n);
  assert.equal(await center.locator('tbody tr').count(),20);
  await center.getByText(/首次掃描符合名單/).waitFor();
  await center.getByRole('button',{name:/最新交易日新增（2026-10-08）/}).waitFor();
  await center.getByRole('button',{name:/再顯示 20 檔/}).click();await waitRows(40);
  await center.getByRole('button',{name:'目前符合',exact:true}).click();await waitRows(20);
  await center.getByRole('button',{name:/均線偏離 36/}).click();assert.equal(await center.locator('tbody tr').count(),20);
  await center.getByText('進階篩選與排序',{exact:true}).click();await center.getByLabel('均線偏離方向').selectOption('low');
  assert.ok(await center.locator('tbody tr').count()>0);for(const row of await center.locator('tbody tr').all())assert.match(await row.textContent(),/均線偏低/);
  await center.getByLabel('均線偏離方向').selectOption('high');for(const row of await center.locator('tbody tr').all())assert.match(await row.textContent(),/均線偏高/);
  await center.getByLabel('均線偏離方向').selectOption('all');await center.getByRole('button',{name:/整理觀察 52/}).click();
  await center.getByLabel(/^排序/).selectOption('upper');await center.locator('tbody tr').first().getByText(/距突破觀察價約/).waitFor();
  await center.getByRole('button',{name:/我的追蹤/}).click();await waitRows(0);
  await center.getByRole('button',{name:'目前符合',exact:true}).click();await center.getByRole('textbox',{name:'搜尋股票'}).fill('2353');
  await waitRows(1);await center.getByRole('button',{name:'查看走勢',exact:true}).click();
  await page.locator('app-alert-detail').getByText(/正在載入\s*宏碁\s*走勢/).waitFor();
  const chart=page.locator('#market-chart svg.stock-chart');await chart.getByText(/區間上緣/).waitFor();
  assert.equal(await page.locator('app-alert-detail svg').count(),0);
  await page.getByRole('button',{name:'顯示提醒區間',exact:true}).click();await chart.getByText(/區間上緣/).waitFor({state:'detached'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await context.close();console.log(width+'px real data: baseline, pagination, counts, directional filtering, sorting, immediate list switch, deferred unified chart and overlay toggle passed.');
 }
}finally{await browser.close();}
