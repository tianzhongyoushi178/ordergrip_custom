/**
 * 3D Canvas のバレル画像をスクリーンショットして X (旧 Twitter) に投稿する。
 *
 * 設計方針: **OS のシェアシートを出さない**。
 *   X の intent URL も twitter:// カスタムスキームも画像をパラメータで
 *   添付できないため、シェアシートを出さずに画像付き投稿を実現するには
 *   クリップボード経由で画像を渡す必要がある。
 *
 * 動作 (すべて同期 - Safari のポップアップブロック回避):
 *   1. canvas.toDataURL() で PNG dataURL を同期取得
 *   2. <a download> で画像をローカル保存 (バックアップ)
 *   3. dataURL を同期で Blob 化 → navigator.clipboard.write でコピー
 *      (fire-and-forget; await しない)
 *   4. プラットフォーム別に X 投稿画面へ遷移
 *      - iOS:     twitter://post?message=...    (X アプリ起動)
 *      - Android: intent://...                   (X アプリ起動、未インストール時 Web)
 *      - Desktop: window.open(x.com/intent/post) (新タブで Web)
 *
 * 投稿後、ユーザーが X の本文エリアで長押し→「ペースト」を選ぶと画像が添付される。
 *
 * ※ Canvas は `preserveDrawingBuffer: true` で作成されている必要がある
 *    (Scene.tsx で設定済み)。
 */

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
    | { status: 'opened'; clipboardCopied: boolean }
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

/** dataURL (data:image/png;base64,xxx) を同期で Blob に変換 */
const dataUrlToBlobSync = (dataUrl: string): Blob => {
    const commaIdx = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, commaIdx);
    const data = dataUrl.slice(commaIdx + 1);
    const mimeMatch = meta.match(/data:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const bytes = atob(data);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return new Blob([buf], { type: mime });
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

export const shareBarrelToX = (): ShareToXResult => {
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

    // 1) 画像をローカルにバックアップダウンロード (クリップボード失敗時の保険)
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'barrel.png';
    document.body.appendChild(link);
    link.click();
    link.remove();

    // 2) クリップボードに画像コピー (fire-and-forget、await しない)
    //    成功すれば X の本文エリアで「ペースト」で添付できる
    let clipboardCopied = false;
    tryCopyImageToClipboard(blob).then((ok) => { clipboardCopied = ok; });
    // 注: ここでは即時 false のままだが、UI フィードバック用には参考値

    // 3) プラットフォーム別に X 投稿画面へ遷移 (同じユーザージェスチャー内で実行)
    const platform = detectPlatform();
    const webUrl = buildXIntentUrl(X_POST_TEXT, shareUrl);

    if (platform === 'ios') {
        window.location.href = buildIOSAppUrl(X_POST_TEXT);
    } else if (platform === 'android') {
        window.location.href = buildAndroidIntentUri(X_POST_TEXT, webUrl);
    } else {
        window.open(webUrl, '_blank', 'noopener,noreferrer');
    }

    return { status: 'opened', clipboardCopied };
};
