/* 建筑内部方案A/B 链路验证：传送至建筑门口 → 进入 → 截图 → 退出 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('http://localhost:5200/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);

  // 找一个建筑并传送玩家到门口旁
  const found = await page.evaluate(() => {
    const { engine } = window.__sandbox;
    const size = engine.getConfig().decisions.chunkSize;
    const total = engine.worldChunksCount * size;
    const bs = engine.getBuildingsInRect(0, 0, total, total);
    if (bs.length === 0) return null;
    const b = bs[0];
    // 直接设置玩家目标位置到门口外一格
    engine['targetX'] = b.doorWorld.x;
    engine['targetY'] = b.doorWorld.y - 1;
    engine['px'] = b.doorWorld.x;
    engine['py'] = b.doorWorld.y - 1;
    engine.enterBuilding(b);
    return { scheme: engine.getConfig().decisions.interiorScheme, building: b.templateId };
  });
  console.log('ENTER:', JSON.stringify(found));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'scripts/interior-B.png' });

  // 退出 + 切方案A 再进
  await page.evaluate(() => {
    const { engine, useConfigStore } = window.__sandbox;
    engine.exitBuilding();
    useConfigStore.getState().setDecisions({ interiorScheme: 'A' });
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const { engine } = window.__sandbox;
    const size = engine.getConfig().decisions.chunkSize;
    const total = engine.worldChunksCount * size;
    const bs = engine.getBuildingsInRect(0, 0, total, total);
    if (bs.length > 0) {
      const b = bs[0];
      engine['targetX'] = b.doorWorld.x;
      engine['targetY'] = b.doorWorld.y - 1;
      engine['px'] = b.doorWorld.x;
      engine['py'] = b.doorWorld.y - 1;
      engine.enterBuilding(b);
    }
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'scripts/interior-A.png' });

  console.log('PAGE_ERRORS:', errors.length === 0 ? '(none)' : errors.slice(0, 6).join('\n'));
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
