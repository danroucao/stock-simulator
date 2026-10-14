// Real local market feed; isolated browser storage and no broker/API mutations.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const feed=JSON.parse(await readFile('public/market/latest.json','utf8'));
const base=process.env.MARKET_TEST_URL||'http://127.0.0.1:4200/';
await mkdir('tmp',{recursive:true});const browser=await chromium.launch({headless:true});
try{for(const width of [1280,390]){
 const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://www.twse.com.tw/**',r=>r.abort());await page.route('**/api/**',r=>r.abort());
 const visit=path=>page.goto(base+'#/'+path);
 await visit('market');const market=page.locator('app-market');await market.locator('.heat-row').first().waitFor();assert.equal(await market.locator('.heat-row').count(),10);
 const unavailable=!feed.industryHeat.some(i=>i.changePoints!==null);
 await page.waitForFunction(expected=>document.querySelector('app-market option[value="increase"]')?.disabled===expected,unavailable);
 assert.equal(await market.getByLabel('產業排序').locator('option[value="increase"]').getAttribute('disabled')!==null,unavailable);
 await market.getByRole('button',{name:'展開全部產業',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('app-market .heat-row').length===n,feed.industryHeat.length);assert.equal(await market.locator('.heat-row').count(),feed.industryHeat.length);
 await market.getByRole('button',{name:'收合為前 10 大',exact:true}).click();await market.getByLabel('搜尋產業',{exact:true}).fill('航運');await page.waitForFunction(()=>document.querySelectorAll('app-market tbody tr').length===1);
 await market.locator('tbody tr').getByRole('link',{name:'航運業',exact:true}).click();const screen=page.locator('app-screener');await screen.getByLabel('產業',{exact:true}).waitFor({state:'attached'});
 if(width<700){await screen.getByRole('button',{name:'篩選與排序',exact:true}).click();assert.ok(await page.evaluate(()=>!!document.activeElement?.closest('app-screener .filter-panel')));await page.screenshot({path:'tmp/screener-drawer-390.png'});}
 await screen.getByLabel('市場',{exact:true}).selectOption('twse');if(width<700)await screen.getByRole('button',{name:'完成篩選',exact:true}).click();await screen.getByRole('button',{name:'高波動',exact:true}).click();
 await page.waitForFunction(()=>{const q=new URLSearchParams(location.hash.split('?')[1]);try{return JSON.parse(q.get('filter')).bounds.volatility.min!==undefined;}catch{return false;}});
 const original=page.url(),query=JSON.parse(new URLSearchParams(original.split('?')[1]).get('filter'));
 assert.equal(query.industry,'航運業');assert.equal(query.market,'twse');assert.ok((query.bounds.volatility.min.toString().split('.')[1]?.length||0)<=2);
 await screen.getByRole('button',{name:/^移除 20 日波動率/}).click();
 await page.waitForFunction(()=>{const q=new URLSearchParams(location.hash.split('?')[1]);try{const f=JSON.parse(q.get('filter'));return !f.bounds.volatility&&f.industry==='航運業'&&f.market==='twse';}catch{return false;}});
 await screen.getByRole('button',{name:'高波動',exact:true}).click();await page.waitForURL(original);
 const expected=feed.stocks.filter(s=>s.industry==='航運業'&&s.market==='twse'&&s.metrics.volatility.value!==null&&s.metrics.volatility.value>=query.bounds.volatility.min-1e-9);
 const count=Math.min(expected.length,20),waitCount=()=>page.waitForFunction(n=>document.querySelectorAll('app-screener tbody tr td strong').length===n,count);
 await waitCount();assert.equal(await screen.locator('tbody tr td strong').count(),count);
 const symbol=expected[0]?.symbol||feed.stocks.find(s=>s.industry==='航運業'&&s.market==='twse'&&s.metrics.close.value!==null).symbol;
 // Zero matches is legitimate on a different date. A direct stock link still must preserve the zero-result filter on return.
 if(count)await screen.locator('tbody tr').filter({hasText:symbol}).getByRole('link',{name:'查看個股',exact:true}).click();else await visit('stock/'+symbol+'?from=screener');await page.getByRole('heading',{name:new RegExp(symbol+'.*個股分析')}).waitFor();
 await page.locator('#market-chart svg.stock-chart path.chart-line').waitFor();assert.equal(await page.locator('app-alert-detail').count(),0);assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('#strategy-board').count(),0);assert.equal(await page.locator('#market-chart text').filter({hasText:/事件 /}).count(),0);
 await page.getByRole('tab',{name:'指標',exact:true}).click();await page.locator('#stock-indicators').waitFor();assert.equal(await page.locator('#market-chart').count(),0);
 await page.getByRole('tab',{name:'交易規劃',exact:true}).click();await page.locator('#strategy-board').waitFor();assert.equal(await page.locator('#stock-indicators').count(),0);await page.reload();await page.locator('#strategy-board').waitFor();
 await page.getByRole('link',{name:'返回選股中心',exact:true}).click();await page.waitForFunction(()=>document.querySelector('app-screener select[aria-label="產業"]')?.value==='航運業');
 assert.equal(await screen.getByLabel('市場',{exact:true}).inputValue(),'twse');await waitCount();assert.equal(await screen.locator('tbody tr td strong').count(),count);
 await page.reload();await screen.locator('.status-line').filter({hasText:feed.date}).waitFor();await waitCount();assert.equal(await screen.getByLabel('產業',{exact:true}).inputValue(),'航運業');assert.equal(await screen.locator('tbody tr td strong').count(),count);
 await page.goBack();await page.getByRole('heading',{name:/個股分析/}).waitFor();await page.goForward();await screen.getByLabel('產業',{exact:true}).waitFor({state:'attached'});await waitCount();assert.equal(await screen.getByLabel('產業',{exact:true}).inputValue(),'航運業');
 await screen.getByRole('button',{name:'重設全部',exact:true}).click();await page.waitForFunction(()=>document.querySelector('app-screener select[aria-label="產業"]')?.value==='all');assert.equal(await screen.getByLabel('市場',{exact:true}).inputValue(),'all');
 // Find a real partial stock and expose all reasons, including the seventy-session SMA direction.
 const partial=feed.stocks.find(s=>s.availability==='partial'&&s.metrics.smaChange.reason);assert.ok(partial);if(width<700)await screen.getByRole('button',{name:'篩選與排序',exact:true}).click();await screen.getByLabel('搜尋股票',{exact:true}).fill(partial.symbol);if(width<700)await screen.getByRole('button',{name:'完成篩選',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('app-screener tbody tr').length===1);await screen.getByText('部分可分析',{exact:true}).click();assert.ok((await screen.textContent()).includes('均線方向所需歷史'));
 await visit('stock/'+symbol);await page.locator('#market-chart svg.stock-chart path.chart-line').waitFor();assert.equal(await page.locator('app-alert-detail').count(),0);
 const alerts=JSON.parse(await readFile('public/alerts/latest.json','utf8')),event=alerts.events.find(e=>alerts.stocks.some(s=>s.symbol===e.symbol));assert.ok(event);
 await visit('stock/'+event.symbol+'?event='+encodeURIComponent(event.id)+'&from=alerts');await page.locator('app-alert-detail').waitFor();assert.ok((await page.locator('app-alert-detail').textContent()).includes('提醒來源'));
 await page.locator('#market-chart svg.stock-chart path.chart-line').waitFor();
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'tmp/ux-revision-'+width+'.png'});
 console.log(width+'px: industry/market + technical preset, URL/back/reload, reset, partial reasons, top-ten/search, stock tabs and explicit-only reminder source passed.');await context.close();
}}finally{await browser.close();}
