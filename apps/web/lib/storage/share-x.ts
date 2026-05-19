/**
 * 3D Canvas のバレル画像をスクリーンショットして X (旧 Twitter) に投稿する。
 *
 * 動作 (すべて同期):
 *   1. canvas.toDataURL() で PNG dataURL を取得 (同期API)
 *   2. <a download> で画像をローカルにダウンロード
 *   3. window.open() で X の投稿画面 (intent URL) を新タブで開く
 *
 * ※ 同期処理にする理由: Safari (iOS/macOS) は `await` を跨ぐと
 *    「ユーザージェスチャー」が消費されたと判定し、後続の window.open()
 *    をポップアップブロックする。そのためクリックハンドラから一切 await
 *    せず、その場で download と open を実行する。
 *
 * ※ x.com ドメインを使う理由: 旧 twitter.com/intent/tweet では X アプリの
 *    Universal Links (iOS) / App Links (Android) の発火が弱く、モバイル
 *    Chrome で Web ページが開いてしまう。x.com 配下の URL のほうがアプリ
 *    起動の成功率が高い。
 *
 * ※ Canvas は `preserveDrawingBuffer: true` で作成されている必要がある
 *    (Scene.tsx で設定済み)。これがないと toDataURL() が空フレームを返す。
 */

export const X_POST_TEXT =
    '世界で1つだけのオリジナルダーツバレルを設計しました! #OrderGrip #ダーツ #バレル';

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

/** iOS の X アプリ用カスタムスキーム (X 公式アプリは旧 twitter:// を維持) */
const buildIOSAppUrl = (text: string): string =>
    `twitter://post?message=${encodeURIComponent(text)}`;

/** Android Chrome 用 intent URI。X アプリ未インストールなら browser_fallback_url が開く */
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

    const shareUrl = typeof window !== 'undefined' ? window.location.origin : undefined;

    // 1) 画像を同期的にダウンロード (dataURL は <a download> で直接保存できる)
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'barrel.png';
    document.body.appendChild(link);
    link.click();
    link.remove();

    // 2) プラットフォーム別に X アプリへの遷移を試行
    const platform = detectPlatform();
    const webUrl = buildXIntentUrl(X_POST_TEXT, shareUrl);

    if (platform === 'ios') {
        // iOS: カスタムスキームを location.href にセットして X アプリを起動
        // Universal Links (x.com/...) はブラウザ内 navigation では発火しないため、
        // 確実にアプリを開くには twitter:// スキームを使う必要がある。
        window.location.href = buildIOSAppUrl(X_POST_TEXT);
    } else if (platform === 'android') {
        // Android Chrome: intent URI。X アプリがインストールされていればアプリ起動、
        // 未インストールなら browser_fallback_url (Web 投稿画面) にフォールバック。
        window.location.href = buildAndroidIntentUri(X_POST_TEXT, webUrl);
    } else {
        // Desktop: アプリが存在しないので Web 投稿画面を新タブで開く
        window.open(webUrl, '_blank', 'noopener,noreferrer');
    }

    return { status: 'opened' };
};
