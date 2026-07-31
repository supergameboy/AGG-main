/* 冒烟测试：加载沙箱页面 → 收集控制台错误 → 截图验证渲染 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('http://localhost:5200/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // 模拟移动（触发跨区块/调度/事件链路）
  for (const key of ['d', 'd', 'd', 's', 's', 'd', 'd']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(2500);

  await page.screenshot({ path: 'scripts/smoke-1-isometric25d.png' });

  // 切到 CSS Grid 渲染器验证决策分叉
  await page.evaluate(() => window.scrollTo(0, 0));
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await b.textContent();
    if (text && text.includes('CSS Grid')) {
      await b.click();
      break;
    }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'scripts/smoke-2-cssgrid.png' });

  console.log('CONSOLE_ERRORS:', errors.length === 0 ? '(none)' : errors.slice(0, 8).join('\n'));
  await browser.close();
})().catch((e) => {
  console.error('SMOKE_FAILED', e);
  process.exit(1);
});
