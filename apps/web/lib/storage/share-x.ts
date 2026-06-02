/**
 * 3D Canvas のバレル画像をスクリーンショットして X (旧 Twitter) に投稿する。
 *
 * ハイブリッド方式: 画像を「ダウンロード」「クリップボード」「Web Share」の
 * 3経路で多重化し、ユーザーがどの経路を選んでも画像が必ず手元にある状態にする。
 *
 * 動作:
 *   1. canvas.toDataURL() で PNG を同期取得
 *   2. <a download> で画像をローカル保存 (バックアップ)
 *   3. 同期で Blob 化 → navigator.clipboard.write で fire-and-forget コピー
 *   4. モバイル: Web Share API (画像ファイル付き) を試行
 *      - シェアシートで X を選ぶ → 画像が自動添付された投稿画面が開く (ベスト)
 *      - シェアシートをキャンセル → X アプリへ intent URL で直接遷移
 *        (ユーザーは本文長押し→「ペースト」でクリップボードの画像を添付できる)
 *   5. Desktop: x.com/intent/post を新タブで開く (X デスクトップアプリは無い)
 *
 * 結果としてユーザーは:
 *   - シェアシート経由なら 1 タップで画像自動添付の X 投稿画面に到達
 *   - シェアシートが煩わしければキャンセル → 直接 X、画像はペーストで添付
 *   - 最悪 Web Share が使えなくても、ダウンロードした barrel.png を手動添付可能
 *
 * ※ Canvas は `preserveDrawingBuffer: true` (Scene.tsx で設定済み)。
 */

import { dataUrlToBlobSync } from './capture';

export const X_POST_TEXT =
    '世界で1つだけのオリジナルダーツバレルを設計しました! #JustOneGRIP';

// X 公式の現行ドメイン。iOS Universal Links / Android App Links は x.com で登録されている。
export const X_INTENT_URL_BASE = 'https://x.com/intent/post';

const buildXIntentUrl = (text: string, shareUrl?: string): string => {
    const params = new URLSearchParams();
    params.set('text', text);
    if (shareUrl) params.set('url', shareUrl);
    return `${X_INTENT_URL_BASE}?${params.toString()}`;
};

export type ShareToXResult =
    | { status: 'opened' }
    | { status: 'failed'; error: string };

type Platform = 'ios' | 'android' | 'desktop';

const detectPlatform = (): Platform => {
    if (typeof navigator === 'undefined') return 'desktop';
    const ua = navigator.userAgent;
    // iPadOS 13+ は MacIntel + touch を返すので両方検出
    const isIOS = /iPhone|iPad|iPod/.test(ua) ||
        (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
    if (isIOS) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
};

/** クリップボードへ画像コピーを試行 (fire-and-forget)。成功可否を Boolean で返す Promise を返却 */
const tryCopyImageToClipboard = (blob: Blob): Promise<boolean> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined') {
        return Promise.resolve(false);
    }
    try {
        const item = new ClipboardItem({ [blob.type]: blob });
        return navigator.clipboard.write([item]).then(() => true).catch(() => false);
    } catch {
        return Promise.resolve(false);
    }
};

/** iOS の X アプリ用カスタムスキーム */
const buildIOSAppUrl = (text: string): string =>
    `twitter://post?message=${encodeURIComponent(text)}`;

/** Android Chrome 用 intent URI */
const buildAndroidIntentUri = (text: string, webFallbackUrl: string): string =>
    `intent://post?text=${encodeURIComponent(text)}` +
    `#Intent;scheme=twitter;package=com.twitter.android;` +
    `S.browser_fallback_url=${encodeURIComponent(webFallbackUrl)};end`;

const openMobileIntent = (platform: 'ios' | 'android', webFallbackUrl: string): void => {
    if (platform === 'ios') {
        window.location.href = buildIOSAppUrl(X_POST_TEXT);
    } else {
        window.location.href = buildAndroidIntentUri(X_POST_TEXT, webFallbackUrl);
    }
};

export const shareBarrelToX = async (): Promise<ShareToXResult> => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) {
        return { status: 'failed', error: 'canvas not found' };
    }

    let dataUrl: string;
    try {
        dataUrl = canvas.toDataURL('image/png');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { status: 'failed', error: `screenshot failed: ${msg}` };
    }
    if (!dataUrl || dataUrl === 'data:,') {
        return { status: 'failed', error: 'canvas is empty' };
    }

    const blob = dataUrlToBlobSync(dataUrl);
    const shareUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
    const webUrl = buildXIntentUrl(X_POST_TEXT, shareUrl);
    const platform = detectPlatform();

    // (1) 画像を同期でローカルにダウンロード (最終フォールバック)
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'barrel.png';
    document.body.appendChild(link);
    link.click();
    link.remove();

    // (2) クリップボードに画像コピー (fire-and-forget、ペースト用)
    void tryCopyImageToClipboard(blob);

    // (3) Desktop: Web 投稿画面を新タブで開いて終了
    if (platform === 'desktop') {
        window.open(webUrl, '_blank', 'noopener,noreferrer');
        return { status: 'opened' };
    }

    // (4) モバイル: まず Web Share API で「画像ファイル付き共有」を試行
    //     成功すれば X 投稿画面で画像が自動添付される
    const file = new File([blob], 'barrel.png', { type: 'image/png' });
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                text: X_POST_TEXT,
                ...(shareUrl ? { url: shareUrl } : {}),
            });
            return { status: 'opened' };
        } catch (err) {
            // ユーザーがシェアシートをキャンセル / その他エラー
            // → X アプリへ intent URL で直接遷移 (画像はクリップボードからペーストで添付)
            if (err instanceof Error && err.name === 'AbortError') {
                openMobileIntent(platform, webUrl);
                return { status: 'opened' };
            }
            // 想定外のエラーでも一応 intent URL で X を開く
            openMobileIntent(platform, webUrl);
            return { status: 'opened' };
        }
    }

    // (5) Web Share API が使えないモバイル: intent URL のみ
    openMobileIntent(platform, webUrl);
    return { status: 'opened' };
};
