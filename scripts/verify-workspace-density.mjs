import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const symbols=['2330','6182','2317','2454','2303','0050'];
const stocks=symbols.map(symbol=>({symbol,name:'驗收測試長名称－'+symbol+'VeryLongNameWithoutSpaces'.repeat(3),latestPrice:100,change:0,quoteDate:'2026-10-08'}));
const positions=symbols.flatMap((symbol,index)=>['現股多單','空單'].map((type,i)=>({id:`density-${index}-${i}`,symbol,type,shares:100,entryPrice:100,targetPrice:type==='空單'?95:105,tradeDate:'2026-10-08',note:'驗收測試'})));
const orders=symbols.flatMap((symbol,index)=>[98,99].map(price=>({id:`order-${index}-${price}`,symbol,type:'現股多單',action:'buy',shares:100,entryPrice:price,validDays:5,createdAt:'2026-10-08T00:00:00Z',expiryDate:'2026-10-16',shareUnit:'oddLot'})));
const seed={version:1,stockSymbol:'2330',stockName:stocks[0].name,stockRecords:stocks,tradePositions:positions,presetOrders:orders,presetFills:[],closedTrades:[],latestPrices:Object.fromEntries(symbols.map(symbol=>[symbol,100])),availableCash:1000000,maxRiskPerTrade:1000,maxStockWeight:25,feeDiscount:.6};
const browser=await chromium.launch({headless:true});
try {
  for(const width of [1280,390]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.addInitScript(data=>localStorage.setItem('stock-simulator-workspace-v1',JSON.stringify(data)),seed);
    await page.route('https://www.twse.com.tw/**',route=>route.fulfill({json:{title:'2330 2330',data:[['115/10/08','100000','59167379273','100','101','99','100','0','100','0']]}}));
    await page.route('**/api/tpex/**',route=>route.fulfill({json:{msgArray:[]}}));
    await page.goto('http://localhost:4200');
    await page.waitForFunction(()=>document.querySelector('.summary-item:nth-child(2)')?.textContent.includes('100'));
    await page.locator('.stock-record-card').first().waitFor({state:'visible'});
    assert.equal(await page.locator('.stock-record-card').count(),6);
    assert.ok((await page.locator('.summary-item.accent').textContent()).includes('VeryLongName'));
    await page.getByRole('link',{name:'行情',exact:true}).click();
    await page.getByText('查看完整金額',{exact:true}).click();
    assert.ok((await page.locator('.stats-grid').textContent()).includes('59,167,379,273 元'));
    await page.getByRole('link',{name:'交易規劃',exact:true}).click();
    await page.getByRole('button',{name:'建立部位',exact:true}).click();
    const form=page.locator('.board-form');
    await form.getByLabel(/^交易類型/).selectOption('空單');
    assert.equal(await form.getByLabel('停損價（選填）',{exact:true}).inputValue(),'105');
    assert.equal(await form.getByLabel('預計出場價（選填）',{exact:true}).inputValue(),'95');
    await page.getByRole('link',{name:'持倉',exact:true}).click();
    await page.getByRole('button',{name:'全部持倉',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.position-group').length===6);
    assert.equal(await page.locator('.preset-order-row').count(),2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const escapes=await page.locator('.record-select').evaluateAll(elements=>elements.some(el=>[...el.children].some(child=>child.getBoundingClientRect().right>el.getBoundingClientRect().right+1)));
    assert.equal(escapes,false,'Long stock names overflow the selection cards');
    await page.screenshot({path:`tmp/density-${width}.png`,fullPage:true});
    console.log(`Verified ${width}: 6 stocks, 12 positions, 12 orders, long names, full turnover, direction defaults`);
    await page.close();
  }
} finally {await browser.close();}
