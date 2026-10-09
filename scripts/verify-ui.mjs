import { chromium } from 'playwright';
const { mkdir } = await import('node:fs/promises');
await mkdir('tmp', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto('http://localhost:4200');
    await page.getByRole('button', { name: '建立部位', exact: true }).click();
    await page.getByRole('button', { name: '收合交易規劃', exact: true }).click();
    await page.getByRole('link', { name: '交易規劃', exact: true }).click();
    await page.locator('.board-form').waitFor({ state: 'visible' });
    const blocked = await page.evaluate(() => document.querySelector('#strategy-board').getBoundingClientRect().top < document.querySelector('.planning-summary').getBoundingClientRect().bottom);
    if (blocked) throw new Error('Navigation target is hidden by the sticky header');
    if (await page.locator('.portfolio-dashboard > .portfolio-metrics > div').count() !== 4) throw new Error('Primary asset summary is not reduced to four metrics');
    await page.getByRole('link', { name:'風險分析', exact:true }).click();
    const trace=page.locator('.stock-stress-table > tbody > tr > td[colspan="7"]');
    const scenarios=page.locator('.stock-stress-table > tbody > tr > td > button');
    if (await trace.count()) throw new Error('Scenario trace should start closed');
    await scenarios.nth(0).click();
    await trace.waitFor({state:'visible'});
    await scenarios.nth(1).click();
    if (await trace.count() !== 1) throw new Error('Scenario traces are duplicated');
    await scenarios.nth(1).click();
    await trace.waitFor({state:'detached'});
    await page.screenshot({ path: `tmp/ui-${width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(width, 'horizontal page overflow:', overflow);
    if (overflow) throw new Error('Page overflow');
    await page.close();
  }
} finally { await browser.close(); }
