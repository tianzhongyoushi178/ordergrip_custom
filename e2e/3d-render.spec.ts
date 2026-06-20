import { test, expect, Page, TestInfo } from '@playwright/test';

/**
 * 3D描画 (Three.js / react-three-fiber) の「シミ」 (shadow acne / 範囲外シャドウサンプル) を
 * リグレッション検知する。pixel-perfect snapshot を持たない代わりに、以下を機械的に検証する:
 *   - WebGL コンテキスト初期化失敗が無い
 *   - Canvas が実描画している (preserveDrawingBuffer=true なので toDataURL で取得できる)
 *   - 視覚条件 (初期, カットあり, カラーあり, 真横ビュー, 共有画像撮影後, 最大寸法) で
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
 * Canvas を toDataURL でキャプチャして artifact 添付する。
 * WebGL canvas に対する locator.screenshot() は「element to be stable」待ちで
 * タイムアウトしやすい(連続描画のため)。preserveDrawingBuffer=true を前提に
 * canvas 自身の toDataURL から PNG を得る方が確実(sampleCanvasPixels と同じ機構)。
 */
const attachCanvas = async (page: Page, testInfo: TestInfo, name: string) => {
  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? c.toDataURL('image/png') : null;
  });
  if (dataUrl && dataUrl.startsWith('data:image/png')) {
    await testInfo.attach(name, {
      body: Buffer.from(dataUrl.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  }
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
    // R3F Canvas は透明(alpha:true)で、その下の暗い CSS 背景(#0a0a0a)が見えている。
    // toDataURL の透明画素を純黒(0,0,0)として読むと背景全体が「黒シミ」に誤カウントされるため、
    // 実際の表示背景色(輝度10>暗判定閾値8)を下地に塗ってから合成し、見たままを測る。
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
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

/** 縦カットを追加。デフォルト長45では z15-30 に入り、カラー区間 (z15-30) と重なる。 */
const addVerticalCut = async (page: Page) => {
  await clickButton(page, /^縦$/);
  await expect(page.getByRole('heading', { name: '縦カット' })).toBeVisible({ timeout: 5_000 });
  await clickButton(page, /^追加$/);
};

/** カラー区間行の「塗り対象」セレクタ (全面/溝のみ/溝以外)。 */
const colorTargetSelect = (page: Page) =>
  page.locator('label', { hasText: '塗り対象' }).locator('select');

/** Canvas をキャプチャし、青系アクセント (B が R/G より明確に大きい) 画素の割合を返す。 */
const blueRatio = async (page: Page): Promise<number> => {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 0;
    const w = canvas.width, h = canvas.height;
    if (w === 0 || h === 0) return 0;
    const c2 = document.createElement('canvas');
    c2.width = w; c2.height = h;
    const ctx = c2.getContext('2d');
    if (!ctx) return 0;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let blue = 0;
    const total = w * h;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (b > 60 && b - r > 25 && b - g > 15) blue++;
    }
    return blue / total;
  });
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

/**
 * range スライダを最大値へ。focus+End はタッチ端末(iPad等)で actionable 待ちになり
 * 不安定なため、React 制御 input の native value setter で max を入れ input/change を
 * 発火させる(全デバイスで確実・高速)。
 */
const sliderToMax = async (page: Page, index: number) => {
  const slider = page.getByRole('slider').nth(index);
  await slider.waitFor({ state: 'visible', timeout: 10_000 });
  await slider.evaluate((el) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, input.max);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

test.describe('3D描画リグレッション', () => {
  test('初期表示: バレルが描画されている (全黒 / 全白 / 全シミ ではない)', async ({ page }, testInfo) => {
    await page.goto('/');
    await skipWizard(page);
    await findCanvas(page);
    // 描画完了まで少し待つ (シャドウマップ・Environment 取得など)
    await page.waitForTimeout(1500);

    await attachCanvas(page, testInfo, '3d-initial.png');
    await assertHealthyCanvas(page);
  });

  test('真横ビュー: 真横ボタンでカメラスナップ後も健全な描画', async ({ page }, testInfo) => {
    await page.goto('/');
    await skipWizard(page);
    await findCanvas(page);
    await page.waitForTimeout(1000);

    // 真横ボタン (page.tsx の固定ツールバー)
    const sideBtn = page.getByRole('button', { name: /真横/ });
    if (await sideBtn.count() > 0) {
      await sideBtn.first().evaluate((el: HTMLButtonElement) => el.click());
      await page.waitForTimeout(800);
    }

    await attachCanvas(page, testInfo, '3d-side-view.png');
    await assertHealthyCanvas(page);
  });

  test('視点リセット後も健全な描画', async ({ page }, testInfo) => {
    await page.goto('/');
    await skipWizard(page);
    await findCanvas(page);
    await page.waitForTimeout(1000);

    const resetBtn = page.getByRole('button', { name: /視点をリセット|リセット/ });
    if (await resetBtn.count() > 0) {
      await resetBtn.first().evaluate((el: HTMLButtonElement) => el.click());
      await page.waitForTimeout(500);
    }

    await attachCanvas(page, testInfo, '3d-after-reset.png');
    await assertHealthyCanvas(page);
  });

  test('カットあり: リングカット追加後も健全な描画', async ({ page }, testInfo) => {
    await openEditor(page);

    await addRingCut(page);
    await page.waitForTimeout(1000);

    await attachCanvas(page, testInfo, '3d-with-cut.png');
    await assertHealthyCanvas(page);
  });

  test('カラーあり: カラー区間追加後も健全な描画', async ({ page }, testInfo) => {
    await openEditor(page);

    await addBlueColorZone(page);
    await page.waitForTimeout(1000);

    await attachCanvas(page, testInfo, '3d-with-color-zone.png');
    await assertHealthyCanvas(page);
  });

  test('共有画像後: X投稿用のキャプチャ後も健全な描画', async ({ page }, testInfo) => {
    await mockShareSideEffects(page);
    await openEditor(page);

    await addRingCut(page);
    await addBlueColorZone(page);
    await clickButton(page, /バレル画像をXに投稿/);
    await page.waitForTimeout(1000);

    await attachCanvas(page, testInfo, '3d-after-share-capture.png');
    await assertHealthyCanvas(page);
  });

  test('意地悪: 全長/最大径を最大にしても健全な描画 (長尺バレルの影シミ防止)', async ({ page }, testInfo) => {
    await openEditor(page);

    // 全長スライダ(1番目)・最大径スライダ(2番目)を最大へ。
    // 全長 150mm は影カメラ near 平面の裏に落ちて影が破綻していた条件(bug7)。
    await sliderToMax(page, 0);
    await sliderToMax(page, 1);
    await page.waitForTimeout(1200);

    await attachCanvas(page, testInfo, '3d-max-dims.png');
    await assertHealthyCanvas(page);
  });

  test('意地悪: 最大寸法 + リングカットでも健全な描画', async ({ page }, testInfo) => {
    await openEditor(page);

    await sliderToMax(page, 0);
    await sliderToMax(page, 1);
    await addRingCut(page);
    await page.waitForTimeout(1200);

    await attachCanvas(page, testInfo, '3d-max-dims-cut.png');
    await assertHealthyCanvas(page);
  });

  test('カラー塗り分け: 縦カット溝で 全面/溝のみ/溝以外 を切替えても健全 & 着色量が変化', async ({ page }) => {
    // 縦カット geometry の再生成 + 大画面 canvas のピクセル読取を複数回行うため余裕を持たせる
    test.setTimeout(240_000);
    await openEditor(page);
    await addVerticalCut(page);
    await addBlueColorZone(page); // 既定は target='all' (全周)
    await page.waitForTimeout(800);
    const allBlue = await blueRatio(page);
    expect(allBlue, '全面: 区間が青く塗られている').toBeGreaterThan(0.005);

    // 溝のみ: 縦カットの溝の中だけ青 → 全面より青が減る
    await colorTargetSelect(page).selectOption('groove');
    await page.waitForTimeout(800);
    const grooveBlue = await blueRatio(page);

    // 溝以外(山だけ): 溝を除外して山に青 → 全面より減るが、外向きの山は可視面が広く溝のみより多い
    await colorTargetSelect(page).selectOption('land');
    await page.waitForTimeout(800);
    const landBlue = await blueRatio(page);

    await assertHealthyCanvas(page); // 塗り分け後も WebGL 破綻なし

    expect(grooveBlue, '溝のみは全面より青が少ない').toBeLessThan(allBlue);
    expect(landBlue, '溝以外も全面より青が少ない').toBeLessThan(allBlue);
    expect(landBlue, '溝以外(山)は溝のみより青が多い').toBeGreaterThan(grooveBlue);
  });
});
