import { test, expect, Page, Locator } from '@playwright/test';

/**
 * iPhone SE2 等の小型端末で SpecWizard / Editor / AdModal がはみ出さず
 * すべてのコンテンツに到達可能 (スクロール可能) であることを検証する。
 *
 * Note: Playwright の `locator.click()` は、本プロジェクトの React Three Fiber
 * Canvas + ポートレートモバイルエミュレーション環境でアクション実行が
 * 不安定になる場合があるため、ボタン操作は `clickButton` ヘルパで
 * HTMLElement.click() を直接呼び出している。
 */

const VIEWPORT_TOLERANCE = 1;

const elementWithinViewport = async (page: Page, locator: Locator) => {
  const box = await locator.evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport size');
  return {
    overflowsBottom: box.y + box.height > viewport.height + VIEWPORT_TOLERANCE,
    overflowsTop: box.y < -VIEWPORT_TOLERANCE,
    overflowsRight: box.x + box.width > viewport.width + VIEWPORT_TOLERANCE,
    overflowsLeft: box.x < -VIEWPORT_TOLERANCE,
    box,
    viewport,
  };
};

const clickButton = async (locator: Locator) => {
  // Wait for the element to be present and enabled, then call native click().
  // We avoid Playwright's `locator.click()` which is unreliable in this app's
  // mobile emulation due to interactions with R3F's render loop.
  await locator.waitFor({ state: 'visible' });
  await locator.evaluate((el: HTMLButtonElement) => el.click());
};

const clickButtonAndExpect = async (
  page: Page,
  locator: Locator,
  expected: () => Promise<unknown>,
  attempts = 3,
) => {
  for (let i = 0; i < attempts; i++) {
    // Re-check expected first — the click from a prior iteration may have
    // already taken effect even if the assertion hadn't observed it yet.
    if (i > 0) {
      try {
        await expected();
        return;
      } catch {
        // fall through to click again
      }
    }
    try {
      await clickButton(locator);
    } catch (err) {
      // If the button is gone the click already produced the change.
      try {
        await expected();
        return;
      } catch {
        if (i === attempts - 1) throw err;
        continue;
      }
    }
    try {
      await expected();
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await page.waitForTimeout(300);
    }
  }
};

const scrollIntoView = async (locator: Locator) => {
  await locator.evaluate((el: HTMLElement) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  });
};

test.describe('SpecWizard - 極小ビューポート対応 (URL バー表示時)', () => {
  // iOS Safari の URL バー表示時を模した小さなビューポート（375x553）でも
  // Step 3 の％選択画面が完全に収まり、フッターまで操作できることを保証する。
  test('iPhone SE2 (URLバー表示・375x553) で Step3 が収まる', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 553 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001',
    });
    const page = await ctx.newPage();
    try {
      await page.goto('/');
      const wizard = page.getByTestId('spec-wizard');
      await expect(wizard).toBeVisible();

      // Step 1 → Step 3 へ進む
      await clickButtonAndExpect(
        page,
        wizard.getByRole('button', { name: '次へ' }),
        () => expect(wizard.getByRole('button', { name: /トルピード/ })).toBeVisible({ timeout: 2_000 }),
      );
      await clickButtonAndExpect(
        page,
        wizard.getByRole('button', { name: '次へ' }),
        () => expect(wizard.getByRole('button', { name: /^95%/ })).toBeVisible({ timeout: 2_000 }),
      );

      const dialog = wizard.locator('> div > div').first();
      const overflow = await elementWithinViewport(page, dialog);
      expect(overflow.overflowsBottom, 'Step3 ダイアログが下にはみ出している').toBeFalsy();
      expect(overflow.overflowsTop, 'Step3 ダイアログが上にはみ出している').toBeFalsy();

      // 開始ボタン (フッター) も完全に表示されている
      const startBtn = wizard.getByRole('button', { name: '開始' });
      const startOverflow = await elementWithinViewport(page, startBtn);
      expect(startOverflow.overflowsBottom, '開始ボタンが下にはみ出している').toBeFalsy();

      // 70% (4 番目の選択肢) も到達可能
      const ts70 = wizard.getByRole('button', { name: /^70%/ });
      const ts70Overflow = await elementWithinViewport(page, ts70);
      expect(ts70Overflow.overflowsBottom, '70%ボタンが下にはみ出している').toBeFalsy();
    } finally {
      await ctx.close();
    }
  });
});

test.describe('SpecWizard - 初回入力画面の全画面対応', () => {
  test('SpecWizard がビューポートに収まる', async ({ page }) => {
    await page.goto('/');
    const wizard = page.getByTestId('spec-wizard');
    await expect(wizard).toBeVisible();

    const dialog = wizard.locator('> div > div').first();
    const overflow = await elementWithinViewport(page, dialog);
    expect(overflow.overflowsBottom, 'SpecWizard が下にはみ出している').toBeFalsy();
    expect(overflow.overflowsTop, 'SpecWizard が上にはみ出している').toBeFalsy();
    expect(overflow.overflowsRight).toBeFalsy();
    expect(overflow.overflowsLeft).toBeFalsy();
  });

  test('SpecWizard 内部スクロール領域が機能している', async ({ page }) => {
    await page.goto('/');
    const wizard = page.getByTestId('spec-wizard');
    await expect(wizard).toBeVisible();

    // ページの <main> が overflow:hidden 相当 (背景スクロールしない)
    const mainOverflow = await page.evaluate(() => getComputedStyle(document.querySelector('main') as HTMLElement).overflow);
    expect(mainOverflow).toContain('hidden');

    // SpecWizard ダイアログが flex-col で内部 scroll 領域を持っている
    const scrollable = wizard.locator('div.overflow-y-auto').first();
    await expect(scrollable).toBeAttached();
    const metrics = await scrollable.evaluate((el: HTMLElement) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(metrics.clientHeight).toBeGreaterThan(0);
  });

  test('Step1〜Step3 のすべての要素に到達でき、開始まで進める', async ({ page }) => {
    await page.goto('/');
    const wizard = page.getByTestId('spec-wizard');
    await expect(wizard).toBeVisible();

    // Step 1
    await expect(wizard.getByText('全長 (mm)')).toBeVisible();
    await expect(wizard.getByText('最大径 (mm)')).toBeVisible();
    const nextBtn1 = wizard.getByRole('button', { name: '次へ' });
    await expect(nextBtn1).toBeVisible();
    const overflow = await elementWithinViewport(page, nextBtn1);
    expect(overflow.overflowsBottom, 'Step1の「次へ」ボタンがはみ出している').toBeFalsy();
    await clickButtonAndExpect(
      page,
      nextBtn1,
      () => expect(wizard.getByRole('button', { name: /トルピード/ })).toBeVisible({ timeout: 2_000 }),
    );

    // Step 2
    await expect(wizard.getByRole('button', { name: /ストレート/ })).toBeVisible();
    await clickButtonAndExpect(
      page,
      wizard.getByRole('button', { name: '次へ' }),
      () => expect(wizard.getByRole('button', { name: /^95%/ })).toBeVisible({ timeout: 2_000 }),
    );

    // Step 3
    const startBtn = wizard.getByRole('button', { name: '開始' });
    await expect(startBtn).toBeVisible();
    const startOverflow = await elementWithinViewport(page, startBtn);
    expect(startOverflow.overflowsBottom, 'Step3の「開始」ボタンがはみ出している').toBeFalsy();
    await clickButtonAndExpect(
      page,
      startBtn,
      () => expect(wizard).toHaveCount(0, { timeout: 2_000 }),
    );
  });
});

test.describe('Editor (メイン画面) - 全画面対応', () => {
  const skipWizard = async (page: Page) => {
    const wizard = page.getByTestId('spec-wizard');
    // wizard はクライアントマウント後に表示される。マウントを待ってから閉じる。
    await expect(wizard).toBeVisible({ timeout: 15_000 });
    await clickButtonAndExpect(
      page,
      wizard.getByRole('button', { name: '閉じる' }),
      () => expect(wizard).toHaveCount(0, { timeout: 2_000 }),
    );
  };

  test('Editor パネルがビューポート内に収まる', async ({ page }) => {
    await page.goto('/');
    await skipWizard(page);

    const editor = page.getByTestId('editor-panel');
    await expect(editor).toBeVisible();
    const overflow = await elementWithinViewport(page, editor);
    expect(overflow.overflowsBottom, 'Editor パネルが下にはみ出している').toBeFalsy();
    expect(overflow.overflowsRight).toBeFalsy();
  });

  test('Editor 内部スクロールで全要素に到達できる', async ({ page }) => {
    await page.goto('/');
    await skipWizard(page);

    const editor = page.getByTestId('editor-panel');
    await expect(editor).toBeVisible();

    // 重量カードが見える
    const weight = editor.getByText('重量', { exact: true });
    await scrollIntoView(weight);
    await expect(weight).toBeVisible();

    // 「ブラウザに保存」ボタンまでスクロールして到達できる
    const saveBtn = editor.getByRole('button', { name: 'ブラウザに保存' });
    await scrollIntoView(saveBtn);
    await expect(saveBtn).toBeVisible();
    const overflow = await elementWithinViewport(page, saveBtn);
    expect(overflow.overflowsBottom, '保存ボタンがビューポート下にはみ出している').toBeFalsy();
  });
});

test.describe('LINE 連携ボタン', () => {
  test('「DXFを公式LINEに送る」ボタンと「友だち追加」リンクが表示される', async ({ page }) => {
    await page.goto('/');
    const wizard = page.getByTestId('spec-wizard');
    await expect(wizard).toBeVisible({ timeout: 15_000 });
    await clickButtonAndExpect(
      page,
      wizard.getByRole('button', { name: '閉じる' }),
      () => expect(wizard).toHaveCount(0, { timeout: 2_000 }),
    );

    const editor = page.getByTestId('editor-panel');
    const shareBtn = editor.getByTestId('share-dxf-line');
    await scrollIntoView(shareBtn);
    await expect(shareBtn).toBeVisible();
    await expect(shareBtn).toContainText(/DXF.*LINE/);

    const friendLink = editor.getByTestId('line-add-friend');
    await scrollIntoView(friendLink);
    await expect(friendLink).toBeVisible();
    await expect(friendLink).toHaveAttribute('href', /lin\.ee/);
  });
});

test.describe('スクリーンショット (画面確認)', () => {
  test('initial wizard / editor のスクリーンショット取得', async ({ page }, testInfo) => {
    await page.goto('/');
    await testInfo.attach('01-initial-wizard.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });

    const wizard = page.getByTestId('spec-wizard');
    await clickButtonAndExpect(
      page,
      wizard.getByRole('button', { name: '次へ' }),
      () => expect(wizard.getByRole('button', { name: /トルピード/ })).toBeVisible({ timeout: 2_000 }),
    );
    await testInfo.attach('02-wizard-step2.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });

    await clickButtonAndExpect(
      page,
      wizard.getByRole('button', { name: '次へ' }),
      () => expect(wizard.getByRole('button', { name: /^95%/ })).toBeVisible({ timeout: 2_000 }),
    );
    await testInfo.attach('03-wizard-step3.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });

    await clickButtonAndExpect(
      page,
      wizard.getByRole('button', { name: '開始' }),
      () => expect(wizard).toHaveCount(0, { timeout: 2_000 }),
    );
    await testInfo.attach('04-editor.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });
});
