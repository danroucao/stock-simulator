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
    await page.screenshot({ path: `tmp/ui-${width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(width, 'horizontal page overflow:', overflow);
    if (overflow) throw new Error('Page overflow');
    await page.close();
  }
} finally { await browser.close(); }
