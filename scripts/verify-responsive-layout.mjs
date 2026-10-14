import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.MARKET_TEST_URL || 'http://127.0.0.1:4200/';
const browser = await chromium.launch({ headless: true });
const insideViewport = async (page, label) => {
  const failures = await page.locator('button:visible,input:visible,select:visible').evaluateAll((nodes) =>
    nodes.map((node) => ({ text:(node.getAttribute('aria-label') || node.textContent || node.getAttribute('placeholder') || '').trim().slice(0,60), rect:node.getBoundingClientRect().toJSON() }))
      .filter(({rect}) => rect.left < -1 || rect.right > innerWidth + 1 || rect.width < 30),
  );
  assert.deepEqual(failures, [], `${label} has clipped controls`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} overflows horizontally`);
};

try {
  for (const width of [360, 768, 1024, 1280]) {
    const context = await browser.newContext({ viewport:{ width, height:900 } });
    const page = await context.newPage();
    await page.route('https://www.twse.com.tw/**', (route) => route.abort());
    await page.route('**/api/**', (route) => route.abort());
    await page.goto(`${base}#/screener`);
    await page.getByRole('heading', { name:'選股中心', exact:true }).waitFor();
    await page.locator('app-screener tbody tr').first().waitFor();
    const menu = page.getByRole('button', { name:'功能選單', exact:true });
    if (width <= 1050) {
      await menu.click();
      const nav = page.getByRole('navigation', { name:'主要導覽' });
      await nav.locator('a').first().waitFor();
      assert.equal(await nav.locator('a').count(), 7);
      assert.equal(await nav.locator('a').first().isVisible(), true);
    } else assert.equal(await menu.isVisible(), false);
    await insideViewport(page, `${width}px screener`);

    await page.goto(`${base}#/trades`);
    await page.locator('#holdings-center').waitFor();
    await insideViewport(page, `${width}px trades`);
    await page.goto(`${base}#/market`);
    await page.getByRole('heading', { name:'市場動向', exact:true }).waitFor();
    await page.locator('app-market tbody tr').first().waitFor();
    await insideViewport(page, `${width}px market`);
    await context.close();
    console.log(`${width}px: navigation, filters, market table, trading controls and horizontal overflow passed.`);
  }
} finally {
  await browser.close();
}
