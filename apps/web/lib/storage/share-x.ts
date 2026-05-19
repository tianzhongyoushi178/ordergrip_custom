/**
 * 3D Canvas のバレル画像をスクリーンショットして X (旧 Twitter) に投稿する。
 *
 * 戦略:
 *   1. WebGL canvas を Blob (PNG) に変換
 *   2. navigator.share (Web Share API Level 2) で画像ファイル付き共有を試行
 *      → iOS Safari / Android Chrome で OS のシェアシートが開く
 *   3. 失敗時はフォールバック: 画像をローカルダウンロード + X の投稿画面を開く
 *      → ユーザーが手動で画像を添付
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
    | { status: 'web-share' }
    | { status: 'download-and-intent' }
    | { status: 'cancelled' }
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

    const file = new File([blob], 'barrel.png', { type: 'image/png' });
    const shareUrl = typeof window !== 'undefined' ? window.location.origin : undefined;

    // Web Share API Level 2: 画像ファイル付きで共有
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                text: X_POST_TEXT,
                ...(shareUrl ? { url: shareUrl } : {}),
            });
            return { status: 'web-share' };
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return { status: 'cancelled' };
            }
            // それ以外のエラーはフォールバックへ
        }
    }

    // フォールバック: ダウンロード + X 投稿画面を開く
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'barrel.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

    window.open(buildXIntentUrl(X_POST_TEXT, shareUrl), '_blank', 'noopener,noreferrer');
    return { status: 'download-and-intent' };
};
