/* 视觉验证：多张截图覆盖关键决策分叉（精灵图集 / 俯视 / 昼夜 / CSS Grid） */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('http://localhost:5200/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);

  // 1. 精灵图集模式 + 较高环境光（验证资源映射 + 地形细节）
  await page.evaluate(() => {
    const { useConfigStore } = window.__sandbox;
    useConfigStore.getState().setRender({ spriteMode: 'sheet', ambientLight: 0.25, fogMode: 'fog' });
    useConfigStore.getState().setWorld({ fovRadius: 8 });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'scripts/shot-1-sheet.png' });

  // 2. 程序化贴图 + 白天（昼夜循环关闭，低暗度）
  await page.evaluate(() => {
    const { useConfigStore } = window.__sandbox;
    useConfigStore.getState().setRender({ spriteMode: 'procedural', ambientLight: 0.05, fogMode: 'off' });
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'scripts/shot-2-day.png' });

  // 3. 俯视 top_down
  await page.evaluate(() => {
    const { useConfigStore } = window.__sandbox;
    useConfigStore.getState().setDecisions({ renderStyle: 'top_down' });
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'scripts/shot-3-topdown.png' });

  // 4. 回到 2.5D 深夜 + 打开面板性能区
  await page.evaluate(() => {
    const { useConfigStore } = window.__sandbox;
    useConfigStore.getState().setDecisions({ renderStyle: 'isometric_25d' });
    useConfigStore.getState().setRender({ ambientLight: 0.7, fogMode: 'fog' });
    useConfigStore.getState().setAutoWalk({ enabled: true, pattern: 'random', speed: 5 });
  });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'scripts/shot-4-night-walk.png' });

  console.log('PAGE_ERRORS:', errors.length === 0 ? '(none)' : errors.slice(0, 6).join('\n'));
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
