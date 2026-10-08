import { chromium } from 'playwright';
const { mkdir } = await import('node:fs/promises');
await mkdir('tmp', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto('http://localhost:4200');
    await page.locator('.export-settings summary').first().waitFor();
    await page.locator('.export-settings summary').first().click();
    await page.getByRole('button', { name: '規劃預設單', exact: true }).click();
    await page.getByRole('button', { name: '收合近期策略下單板', exact: true }).click();
    await page.getByRole('link', { name: '交易規劃', exact: true }).click();
    await page.locator('.board-form').waitFor({ state: 'visible' });
    const blocked = await page.evaluate(() => document.querySelector('#strategy-board').getBoundingClientRect().top < document.querySelector('.planning-summary').getBoundingClientRect().bottom);
    if (blocked) throw new Error('Navigation target is hidden by the sticky header');
    await page.screenshot({ path: `tmp/ui-${width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(width, 'horizontal page overflow:', overflow);
    if (overflow) throw new Error('Page overflow');
    await page.close();
  }
} finally { await browser.close(); }
