// Uses real local scan data. Browser contexts are isolated; trading fixture is explicit.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const market=JSON.parse(await readFile('public/market/latest.json','utf8'));
await mkdir('tmp',{recursive:true});const browser=await chromium.launch({headless:true});
try{for(const width of [1280,390]){
 const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();const errors=[];let fail=false;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/market/latest.json',r=>fail?r.fulfill({status:503,body:'Unavailable'}):r.continue());
 await page.route('https://www.twse.com.tw/**',r=>r.abort());await page.route('**/api/**',r=>r.abort());
 const base=process.env.MARKET_TEST_URL||'http://127.0.0.1:4200/';const visit=path=>page.goto(base+'#/'+path);
 await visit('screener');await page.getByRole('heading',{name:'選股中心',exact:true}).waitFor();
 const screen=page.locator('app-screener');await screen.locator('tbody tr td strong').first().waitFor();
 assert.equal(await screen.locator('tbody tr').count(),20);
 assert.equal(await page.locator('.portfolio-dashboard').count(),0);
 await screen.getByLabel('搜尋股票',{exact:true}).fill('2353');await page.waitForFunction(()=>document.querySelectorAll('app-screener tbody tr').length===1);
 await screen.getByRole('link',{name:'查看個股',exact:true}).click();await page.waitForURL('**#/stock/2353?from=screener');
 await page.getByRole('heading',{name:/2353.*個股分析/}).waitFor();await page.locator('app-workspace #market-chart svg.stock-chart path.chart-line').waitFor();
 await page.getByRole('link',{name:'返回選股中心',exact:true}).click();await screen.waitFor();assert.equal(await screen.getByLabel('搜尋股票',{exact:true}).inputValue(),'2353');
 await screen.getByRole('button',{name:'自訂',exact:true}).click();await screen.getByRole('button',{name:'載入更多 20 檔'}).click();await page.waitForFunction(()=>document.querySelectorAll('app-screener tbody tr').length===40);
 await screen.getByRole('button',{name:'均線偏低',exact:true}).click();await page.waitForTimeout(100);for(const row of await screen.locator('tbody tr').all())assert.ok((await row.textContent()).includes('均線偏離'));
 await screen.getByText('儲存條件與站內追蹤',{exact:true}).click();await screen.getByLabel('條件名稱',{exact:true}).fill('測試條件');await screen.getByLabel('啟用站內事件追蹤',{exact:true}).check();await screen.getByRole('button',{name:'儲存條件',exact:true}).click();await screen.getByRole('button',{name:'套用 測試條件',exact:true}).waitFor();
 await page.reload();await screen.getByText('儲存條件與站內追蹤',{exact:true}).click();await screen.getByRole('button',{name:'套用 測試條件',exact:true}).waitFor();
 await visit('alerts');await page.getByRole('heading',{name:'我的條件事件'}).waitFor();assert.ok((await page.locator('app-alert-page').textContent()).includes('首次符合名單'));
 await visit('market');await page.getByRole('heading',{name:'市場動向',exact:true}).waitFor();await page.locator('app-market tbody tr').first().waitFor();
 const industry=market.industryHeat.find(i=>i.industry!=='未分類').industry;await page.locator('app-market .heat-row').getByRole('link',{name:industry,exact:true}).click();await screen.waitFor();await page.waitForFunction(industry=>document.querySelector('app-screener select[aria-label="產業"]')?.value===industry,industry);assert.equal(await screen.getByLabel('產業',{exact:true}).inputValue(),industry);
 await page.goBack();await page.getByRole('heading',{name:'市場動向',exact:true}).waitFor();
 await visit('stock/2330');await page.getByRole('heading',{name:/2330.*個股分析/}).waitFor();await page.reload();await page.getByRole('heading',{name:/2330.*個股分析/}).waitFor();
 await visit('settings');await page.getByRole('heading',{name:'設定',exact:true}).waitFor();assert.equal(await page.locator('.portfolio-dashboard').count(),0);assert.equal(await page.locator('#market-chart').count(),0);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'匯出選股條件',exact:true}).click();const download=await downloadPromise;
 const backup=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(backup.saved[0].name,'測試條件');assert.ok(backup.events.length>0);
 const beforeImport=await page.evaluate(()=>localStorage.getItem('stock-screen-state-v1'));
 await page.getByLabel('匯入選股條件',{exact:true}).setInputFiles({name:'isolated-screen-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
 await page.getByRole('button',{name:'確認匯入選股條件',exact:true}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('stock-screen-state-v1')),beforeImport,'preview must not replace saved data');
 await page.getByRole('button',{name:'確認匯入選股條件',exact:true}).click();assert.deepEqual(JSON.parse(await page.evaluate(()=>localStorage.getItem('stock-screen-state-before-import'))).saved,backup.saved);
 await page.reload();await page.getByRole('heading',{name:'設定',exact:true}).waitFor();assert.deepEqual(JSON.parse(await page.evaluate(()=>localStorage.getItem('stock-screen-state-v1'))).saved,backup.saved);
 await page.evaluate(()=>{location.hash='/stock/2353';location.hash='/stock/2330';});await page.getByRole('heading',{name:/2330.*個股分析/}).waitFor();assert.ok(page.url().includes('#/stock/2330'));
 await visit('overview');await page.locator('.portfolio-dashboard').waitFor();assert.equal(await page.locator('#strategy-board').count(),0);assert.equal(await page.locator('#workspace-settings').count(),0);
 await visit('trades');await page.locator('#holdings-center').waitFor();assert.equal(await page.locator('#market-chart').count(),0);
 await visit('screener');await screen.getByRole('heading',{name:'選股中心',exact:true}).waitFor();fail=true;await page.reload();await screen.getByRole('alert').filter({hasText:'HTTP 503'}).waitFor();assert.ok((await screen.textContent()).includes(market.date),'cached data survives a reload and failed download');fail=false;
 await page.goto(base+'#alert-center');await page.waitForURL('**#/alerts');await page.getByRole('heading',{name:'提醒中心',exact:true}).waitFor();
 if(width===390){await page.getByRole('button',{name:'功能選單',exact:true}).click();await page.getByRole('navigation',{name:'主要導覽'}).getByRole('link',{name:'市場動向',exact:true}).click();await page.getByRole('heading',{name:'市場動向',exact:true}).waitFor();}
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no narrow screen overflow');
 await page.screenshot({path:'tmp/market-pages-'+width+'.png',fullPage:false});assert.deepEqual(errors,[]);
 await context.close();console.log(width+'px: hash direct/reload/back, page separation, list restoration, pagination, saved conditions, baseline events, industry handoff, charts and mobile navigation passed.');
}}finally{await browser.close();}
