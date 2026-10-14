import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const market=JSON.parse(await readFile('public/market/latest.json','utf8')),alerts=JSON.parse(await readFile('public/alerts/latest.json','utf8'));
const stock=market.stocks[0],follow=alerts.stocks.find(item=>item.symbol===stock.symbol)||alerts.stocks[0];
const quotes=market.stocks.map(item=>({symbol:item.symbol,name:item.name,date:'20261014',time:'10:00:00',open:50,high:52,low:49,close:51,previousClose:50,change:1,volume:100000}));
const snapshot={schemaVersion:1,status:'ready',quoteDate:'2026-10-14',generatedAt:'2026-10-14T02:00:00Z',source:'TWSE MIS 延遲快照',coverage:{valid:quotes.length,total:market.stocks.length},quotes,provisionalEvents:[{id:'intraday:test',symbol:stock.symbol,name:stock.name,market:stock.market,state:'盤中突破待收盤確認',quoteDate:'20261014',quoteTime:'10:00:00',price:51,lower:45,upper:50,reason:'盤中成交價高於既有區間上緣 50 元，仍待收盤確認。'}]};
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
 await page.clock.setFixedTime(new Date('2026-10-14T02:00:00Z'));
 await page.addInitScript(value=>localStorage.setItem('stock-alert-follows-v1',JSON.stringify(value)),[{symbol:follow.symbol,name:follow.name,market:follow.market}]);
 await page.route('**/api/intraday-market',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot)}));
 await page.route('**/api/quotes?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({msgArray:[{c:follow.symbol,n:follow.name,d:'20261014',t:'10:00:00',z:'51',y:'50',o:'50',h:'52',l:'49',v:'100'}]})}));
 await page.route('https://www.twse.com.tw/**',route=>route.abort());
 const base=process.env.MARKET_TEST_URL||'http://127.0.0.1:4200/';
 await page.goto(base+'#/screener');await page.getByRole('heading',{name:'選股中心',exact:true}).waitFor();
 await page.getByText(/盤中快照.*／/).waitFor();await page.getByText(/盤中 51(?:\.0+)? 元/).first().waitFor();
 await page.goto(base+'#/alerts');await page.getByRole('heading',{name:'盤中暫時事件',exact:true}).waitFor();
 await page.getByText('盤中突破待收盤確認',{exact:false}).waitFor();
 await page.getByRole('button',{name:/我的追蹤/}).click();await page.getByRole('button',{name:'啟用盤中追蹤',exact:true}).click();
 await page.getByText(/已更新 1／1 檔/).waitFor();assert.match(await page.locator('app-alert-center').textContent(),/盤中 51(?:\.0+)? 元/);
 await context.close();console.log('Intraday shared snapshot, provisional events and batched watchlist quotes passed.');
}finally{await browser.close();}
