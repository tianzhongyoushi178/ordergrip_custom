/**
 * 3D Canvas のバレル画像をスクリーンショットして X (旧 Twitter) に投稿する。
 *
 * 動作:
 *   1. WebGL canvas を Blob (PNG) に変換 → ローカルにダウンロード
 *   2. X の投稿画面 (intent URL) を直接開く
 *      → スマホで X アプリ未インストールなら twitter.com の投稿画面、
 *        インストール済みなら universal link で X アプリが開く
 *
 * ※ OS のシェアシート (Web Share API) は使わない。ユーザーが「X に直接行きたい」
 *    と望むため、選択肢を挟まず投稿画面に飛ばす。画像は別途ダウンロードされる
 *    ので、X 投稿画面で添付する。
 *
 * 注意: Canvas は `preserveDrawingBuffer: true` で作成されている必要がある
 * (Scene.tsx で設定済み)。これがないと toBlob() が空のフレームを返す。
 */

export const X_POST_TEXT =
    '世界で1つだけのオリジナルダーツバレルを設計しました! #OrderGrip #ダーツ #バレル';

export const X_INTENT_URL_BASE = 'https://twitter.com/intent/tweet';

const buildXIntentUrl = (text: string, shareUrl?: string): string => {
    const params = new URLSearchParams();
    params.set('text', text);
    if (shareUrl) params.set('url', shareUrl);
    return `${X_INTENT_URL_BASE}?${params.toString()}`;
};

export type ShareToXResult =
    | { status: 'opened' }
    | { status: 'failed'; error: string };

const captureCanvasBlob = async (): Promise<Blob | null> => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) return null;
    return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
};

export const shareBarrelToX = async (): Promise<ShareToXResult> => {
    let blob: Blob | null;
    try {
        blob = await captureCanvasBlob();
    } catch (err) {
        return { status: 'failed', error: `screenshot failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!blob) {
        return { status: 'failed', error: 'canvas not found or empty' };
    }

    const shareUrl = typeof window !== 'undefined' ? window.location.origin : undefined;

    // 画像をローカルにダウンロード
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'barrel.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

    // X の投稿画面を直接開く (アプリインストール済みなら universal link で X アプリへ)
    window.open(buildXIntentUrl(X_POST_TEXT, shareUrl), '_blank', 'noopener,noreferrer');
    return { status: 'opened' };
};
