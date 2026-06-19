import { test, expect, Page } from '@playwright/test';

/**
 * 3D描画 (Three.js / react-three-fiber) の「シミ」 (shadow acne / 範囲外シャドウサンプル) を
 * リグレッション検知する。pixel-perfect snapshot を持たない代わりに、以下を機械的に検証する:
 *   - WebGL コンテキスト初期化失敗が無い
 *   - Canvas が実描画している (preserveDrawingBuffer=true なので toDataURL で取得できる)
 *   - 視覚条件 (初期, カットあり, カラーあり, 真横ビュー, 共有画像撮影後) で
 *     スクリーンショットを残し、目視/CI artifact 比較が出来るようにする
 *
 * Three.js の lighting/shadow 設定変更が再発しないかの最低限のガード。
 */

const skipWizard = async (page: Page) => {
  const wizard = page.getByTestId('spec-wizard');
  await expect(wizard).toBeVisible({ timeout: 15_000 });
  await wizard.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLButtonElement) => el.click());
  await expect(wizard).toHaveCount(0, { timeout: 4_000 });
};

const findCanvas = async (page: Page) => {
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  return canvas;
};

/**
 * Canvas を toDataURL でキャプチャし、全画素 (alpha無視) の RGB ヒストグラムを返す。
 * 全黒 / 全白 / 単色になっていたら描画が破綻している。
 */
const sampleCanvasPixels = async (page: Page) => {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return null;
    // 2D コンテキストで pixel を読むため、別 canvas にコピーしてから getImageData。
    const c2 = document.createElement('canvas');
    c2.width = w;
    c2.height = h;
    const ctx = c2.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let rSum = 0, gSum = 0, bSum = 0;
    let darkPixels = 0;       // 「シミ」候補: 明度がほぼ 0 の画素
    let nonBgPixels = 0;      // 背景以外 (グレー値が中間域) の画素
    const total = w * h;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      rSum += r; gSum += g; bSum += b;
      const lum = (r + g + b) / 3;
      if (lum < 8) darkPixels++;
      if (lum > 16 && lum < 240) nonBgPixels++;
    }
    return {
      w, h, total,
      rAvg: rSum / total,
      gAvg: gSum / total,
      bAvg: bSum / total,
      darkRatio: darkPixels / total,
      nonBgRatio: nonBgPixels / total,
    };
  });
};

const assertHealthyCanvas = async (page: Page) => {
  const stats = await sampleCanvasPixels(page);
  expect(stats, 'canvas pixel stats').not.toBeNull();
  if (!stats) return;
  // バレル本体が描画されている = 中間明度の画素が一定割合存在する
  expect(stats.nonBgRatio, '中間明度画素割合 (バレル本体)').toBeGreaterThan(0.01);
  // 暗黒画素が支配的でない = シャドウ範囲外サンプリングで真っ黒シミが広がっていない
  expect(stats.darkRatio, '黒シミ画素割合').toBeLessThan(0.5);
};

const clickButton = async (page: Page, name: string | RegExp) => {
  const button = page.getByRole('button', { name }).first();
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.evaluate((el: HTMLButtonElement) => el.click());
};

const openEditor = async (page: Page) => {
  await page.goto('/');
  await skipWizard(page);
  await findCanvas(page);
  await expect(page.getByTestId('editor-panel')).toBeVisible({ timeout: 10_000 });
};

const addRingCut = async (page: Page) => {
  await clickButton(page, /^リング$/);
  await expect(page.getByRole('heading', { name: 'リングカット' })).toBeVisible({ timeout: 5_000 });
  await clickButton(page, /^追加$/);
  await expect(page.getByText('カットが追加されていません')).toHaveCount(0, { timeout: 5_000 });
};

const addBlueColorZone = async (page: Page) => {
  await clickButton(page, 'ブルー');
  await clickButton(page, /カラー区間を追加/);
  await expect(page.getByText('未設定（全体が金属色）')).toHaveCount(0, { timeout: 5_000 });
};

const mockShareSideEffects = async (page: Page) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'open', {
      value: () => null,
      configurable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        write: async () => undefined,
        writeText: async () => undefined,
      },
      configurable: true,
    });
  });
};

test.describe('3D描画リグレッション', () => {
  test('初期表示: バレルが描画されている (全黒 / 全白 / 全シミ ではない)', async ({ page }, testInfo) => {
    await page.goto('/');
    await skipWizard(page);
    const canvas = await findCanvas(page);
    // 描画完了まで少し待つ (シャドウマップ・Environment 取得など)
    await page.waitForTimeout(1500);

    await testInfo.attach('3d-initial.png', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    const stats = await sampleCanvasPixels(page);
    expect(stats, 'canvas pixel stats').not.toBeNull();
    if (!stats) return;
    // バレル本体が描画されている = 中間明度の画素が一定割合存在する
    expect(stats.nonBgRatio, '中間明度画素割合 (バレル本体)').toBeGreaterThan(0.01);
    // 暗黒画素が支配的でない = シャドウ範囲外サンプリングで真っ黒シミが広がっていない
    expect(stats.darkRatio, '黒シミ画素割合').toBeLessThan(0.5);
  });

  test('真横ビュー: 真横ボタンでカメラスナップ後も健全な描画', async ({ page }, testInfo) => {
    await page.goto('/');
    await skipWizard(page);
    const canvas = await findCanvas(page);
    await page.waitForTimeout(1000);

    // 真横ボタン (page.tsx の固定ツールバー)
    const sideBtn = page.getByRole('button', { name: /真横/ });
    if (await sideBtn.count() > 0) {
      await sideBtn.first().evaluate((el: HTMLButtonElement) => el.click());
      await page.waitForTimeout(800);
    }

    await testInfo.attach('3d-side-view.png', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    const stats = await sampleCanvasPixels(page);
    expect(stats).not.toBeNull();
    if (!stats) return;
    expect(stats.nonBgRatio).toBeGreaterThan(0.01);
    expect(stats.darkRatio).toBeLessThan(0.5);
  });

  test('視点リセット後も健全な描画', async ({ page }, testInfo) => {
    await page.goto('/');
    await skipWizard(page);
    const canvas = await findCanvas(page);
    await page.waitForTimeout(1000);

    const resetBtn = page.getByRole('button', { name: /視点をリセット|リセット/ });
    if (await resetBtn.count() > 0) {
      await resetBtn.first().evaluate((el: HTMLButtonElement) => el.click());
      await page.waitForTimeout(500);
    }

    await testInfo.attach('3d-after-reset.png', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    const stats = await sampleCanvasPixels(page);
    expect(stats).not.toBeNull();
    if (!stats) return;
    expect(stats.nonBgRatio).toBeGreaterThan(0.01);
    expect(stats.darkRatio).toBeLessThan(0.5);
  });

  test('カットあり: リングカット追加後も健全な描画', async ({ page }, testInfo) => {
    await openEditor(page);
    const canvas = await findCanvas(page);

    await addRingCut(page);
    await page.waitForTimeout(1000);

    await testInfo.attach('3d-with-cut.png', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await assertHealthyCanvas(page);
  });

  test('カラーあり: カラー区間追加後も健全な描画', async ({ page }, testInfo) => {
    await openEditor(page);
    const canvas = await findCanvas(page);

    await addBlueColorZone(page);
    await page.waitForTimeout(1000);

    await testInfo.attach('3d-with-color-zone.png', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await assertHealthyCanvas(page);
  });

  test('共有画像後: X投稿用の真横キャプチャ後も健全な描画', async ({ page }, testInfo) => {
    await mockShareSideEffects(page);
    await openEditor(page);
    const canvas = await findCanvas(page);

    await addRingCut(page);
    await addBlueColorZone(page);
    await clickButton(page, /バレル画像をXに投稿/);
    await page.waitForTimeout(1000);

    await testInfo.attach('3d-after-share-capture.png', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await assertHealthyCanvas(page);
  });
});
