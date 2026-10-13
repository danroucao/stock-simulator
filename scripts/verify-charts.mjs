import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp',{recursive:true});
const dates=[];const cursor=new Date('2026-10-08T00:00:00Z');
while(dates.length<60){if(![0,6].includes(cursor.getUTCDay()))dates.unshift(cursor.toISOString().slice(0,10));cursor.setUTCDate(cursor.getUTCDate()-1);}
const rows=dates.map((date,i)=>[`${+date.slice(0,4)-1911}/${date.slice(5,7)}/${date.slice(8,10)}`,'100000','10000000',String(100+i),String(102+i),String(99+i),String(101+i),'1','100','0']);
const browser=await chromium.launch({headless:true});
try {for(const width of [1280,390]) {
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width===390});let lookups=0;
  await page.route('**/api/tpex/**',route=>{
    if(route.request().url().includes('stock-info')){lookups++;return route.fulfill({json:{data:[{stock_id:'2330',stock_name:'台積電'},{stock_id:'6182',stock_name:'合晶'}]}});}
    return route.fulfill({json:{msgArray:[]}});
  });
  await page.route('https://www.twse.com.tw/**',route=>{const symbol=new URL(route.request().url()).searchParams.get('stockNo');return route.fulfill({json:{title:`${symbol} ${symbol}`,data:rows}});});
  await page.goto('http://localhost:4200');
  await page.locator('.stock-record-add input').fill('6182');await page.locator('.stock-record-add input').press('Enter');
  await page.waitForFunction(()=>document.querySelector('.summary-item.accent')?.textContent.includes('6182 · 合晶'));
  assert.equal(lookups,1);
  await page.getByRole('link',{name:'行情',exact:true}).click();
  await page.getByRole('button',{name:'60 日',exact:true}).click();
  await page.getByRole('button',{name:'OBV',exact:true}).click();
  await page.getByRole('button',{name:'A/D 累積線',exact:true}).click();
  await page.getByRole('button',{name:'A/D 紅綠棒',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.chart-dates').length===4);
  for(const axis of await page.locator('.chart-dates').all()) assert.equal(await axis.locator('time').count(),60);
  await page.getByText('短線規劃參考',{exact:false}).first().click();
  const svg=page.locator('.stock-chart');await svg.scrollIntoViewIfNeeded();
  const bounds=await svg.boundingBox();const scroll=await page.locator('.dated-chart').first().boundingBox();
  const x=Math.min(scroll.x+120,scroll.x+scroll.width-15),y=Math.max(110,bounds.y+Math.min(100,bounds.height/2));
  await page.mouse.move(x,y);
  await page.locator('.chart-tooltip').waitFor({state:'visible'});
  const tip=await page.locator('.chart-tooltip').boundingBox();
  assert.ok(tip.y>=0&&tip.y+tip.height<=900);
  assert.ok(tip.x>=0&&tip.x+tip.width<=width);
  assert.ok(Math.abs(tip.y-y)<25,'Tooltip uses the chart wrapper origin instead of cursor coordinates');
  await page.locator('.dated-chart').first().evaluate(el=>el.scrollLeft=300);
  await page.waitForFunction(()=>[...document.querySelectorAll('.dated-chart')].every(el=>el.scrollLeft===300));
  for (const days of [5,20,60]) {
    await page.getByRole('button',{name:`${days} 日`,exact:true}).click();
    await page.waitForFunction(days => [...document.querySelectorAll('.chart-dates')].every(el=>el.querySelectorAll('time').length===days),days);
    await page.waitForFunction(()=>[...document.querySelectorAll('.dated-chart')].every(el=>el.scrollLeft===0));
    assert.equal(await page.locator('.chart-tooltip').count(),0);
  }
  await svg.scrollIntoViewIfNeeded();
  const tap=await page.locator('.dated-chart').first().boundingBox();
  if (width===390) await page.touchscreen.tap(tap.x+100,tap.y+80);
  else await page.mouse.click(tap.x+100,tap.y+80);
  await page.locator('.chart-tooltip').waitFor({state:'visible'});
  await page.locator('.chart-section-label').first().click();
  await page.locator('.chart-tooltip').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`tmp/charts-${width}.png`});
  console.log(`Verified ${width}: Chinese name, 60 dates on four charts, cursor tooltip, synchronized scrolling`);
  await page.close();
}}finally{await browser.close();}
