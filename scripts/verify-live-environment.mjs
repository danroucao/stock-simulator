import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('tmp/live-acceptance', { recursive:true });
const browser = await chromium.launch({headless:true});
const evidence = [];
try {
  for (const width of [1280,390]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    await page.route('**/runtime-config.js', route => route.fulfill({contentType:'application/javascript',body:"globalThis.__STOCK_APP_CONFIG__ = { tpexProxyUrl:'https://stock-simulator-tpex-proxy.danroucao.workers.dev' };"}));
    const errors=[];
    page.on('response', async response => {
      if(response.url().includes('/api/history')) {
        try { const body=await response.json(); console.log(JSON.stringify({historyUrl:response.url(),status:response.status(),message:body.msg,dataRows:Array.isArray(body.data)?body.data.length:null})); } catch { console.log(JSON.stringify({historyUrl:response.url(),status:response.status()})); }
      }
    });
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto('http://localhost:4200');
    for (const symbol of ['2330','6182']) {
      if(symbol !== '2330') {
        await page.locator('.stock-record-add input').fill(symbol);
        await page.locator('.stock-record-add input').press('Enter');
        await page.waitForFunction(symbol => document.querySelector('.summary-item.accent strong')?.textContent.trim().startsWith(symbol),symbol);
      }
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='載入中…'), null, {timeout:60000});
      await page.waitForFunction(() => document.querySelectorAll('.stock-chart rect').length > 0 || !!document.querySelector('.hero-card .error-text') || [...document.querySelectorAll('.error-text')].some(el => el.textContent.includes('歷史行情')), null, {timeout:60000});
      const snapshot=await page.evaluate(()=>({
        summary:[...document.querySelectorAll('.summary-item')].map(el=>el.textContent.trim()),
        source:[...document.querySelectorAll('.chart-wrap .backtest-note')].map(el=>el.textContent.trim()).find(t=>t.startsWith('來源：')),
        error:document.querySelector('.hero-card .error-text')?.textContent.trim()??'',
        candles:document.querySelectorAll('.stock-chart rect').length,
        historyError:[...document.querySelectorAll('.error-text')].map(el=>el.textContent.trim()).find(t=>t.includes('歷史行情'))??'',
        overflow:document.documentElement.scrollWidth>innerWidth,
      }));
      evidence.push({width,symbol,...snapshot});
      assert.ok(snapshot.summary[0].includes(symbol));
      assert.equal(snapshot.overflow,false);
      assert.ok(snapshot.source || snapshot.error, 'Quote must display its source or failure');
      await page.getByRole('link',{name:'行情',exact:true}).click();
      await page.locator('#market-chart').screenshot({path:`tmp/live-acceptance/market-${width}-${symbol}.png`});
    }
    await page.getByRole('link',{name:'交易規劃',exact:true}).click();
    await page.getByRole('button',{name:'建立部位',exact:true}).click();
    await page.locator('.board-form').screenshot({path:`tmp/live-acceptance/form-${width}.png`});
    await page.getByRole('link',{name:'持倉',exact:true}).click();
    await page.getByRole('button',{name:'全部持倉',exact:true}).click();
    await page.locator('.position-group-header').first().waitFor({state:'visible'});
    if (!await page.getByRole('button',{name:'記錄平倉',exact:true}).count()) await page.locator('.position-group-header').first().click();
    await page.getByRole('button',{name:'記錄平倉',exact:true}).first().waitFor({state:'visible'});
    if (await page.getByRole('button',{name:'記錄平倉',exact:true}).count()) {
      await page.getByRole('button',{name:'記錄平倉',exact:true}).first().click();
      const dialog=page.locator('#position-close-dialog');
      await dialog.waitFor({state:'visible'});
      await dialog.screenshot({path:`tmp/live-acceptance/close-${width}.png`});
      await page.keyboard.press('Escape');
    }
    assert.equal(errors.length,0,JSON.stringify(errors));
    await page.close();
  }
  await writeFile('tmp/live-acceptance/results.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
} finally {await browser.close();}
