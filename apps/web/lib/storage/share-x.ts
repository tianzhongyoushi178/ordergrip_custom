/**
 * 3D Canvas のバレル画像をスクリーンショットして X (旧 Twitter) に投稿する。
 *
 * 動作 (プラットフォーム別):
 *   - モバイル (iOS / Android): Web Share API (navigator.share) で
 *     画像ファイル付きで共有。OS のシェアシートから X を選べば、
 *     X アプリの投稿画面に画像が**自動添付**された状態で遷移する。
 *   - Desktop: canvas.toDataURL() で同期的にダウンロード → window.open()
 *     で X 投稿画面を新タブで開く (デスクトップに X アプリは無いため)。
 *
 * ※ 画像添付に Web Share API が必須な理由: X の intent URL も
 *    twitter:// カスタムスキームも、画像をパラメータで添付する手段を
 *    提供していない。クライアント完結で画像付き投稿を実現する唯一の
 *    Web 標準 API が navigator.share である。
 *
 * ※ Desktop が同期処理な理由: Safari (macOS) は await を跨ぐと
 *    「ユーザージェスチャー」が消費されたと判定し、後続の window.open()
 *    をポップアップブロックする。toDataURL は同期 API なので await 不要。
 *
 * ※ Canvas は `preserveDrawingBuffer: true` で作成されている必要がある
 *    (Scene.tsx で設定済み)。
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
    | { status: 'cancelled' }
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

const captureCanvasBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));

export const shareBarrelToX = async (): Promise<ShareToXResult> => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) {
        return { status: 'failed', error: 'canvas not found' };
    }

    const platform = detectPlatform();
    const shareUrl = typeof window !== 'undefined' ? window.location.origin : undefined;

    // モバイル: Web Share API で画像ファイル付き共有 (X アプリで画像自動添付)
    if (platform === 'ios' || platform === 'android') {
        let blob: Blob | null;
        try {
            blob = await captureCanvasBlob(canvas);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { status: 'failed', error: `screenshot failed: ${msg}` };
        }
        if (!blob) {
            return { status: 'failed', error: 'canvas toBlob failed' };
        }

        const file = new File([blob], 'barrel.png', { type: 'image/png' });
        if (!navigator.canShare?.({ files: [file] })) {
            return {
                status: 'failed',
                error: 'このブラウザは画像付き共有 (Web Share API Level 2) に対応していません。最新の Safari / Chrome をお使いください。',
            };
        }

        try {
            await navigator.share({
                files: [file],
                text: X_POST_TEXT,
                ...(shareUrl ? { url: shareUrl } : {}),
            });
            return { status: 'opened' };
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return { status: 'cancelled' };
            }
            const msg = err instanceof Error ? err.message : String(err);
            return { status: 'failed', error: `共有失敗: ${msg}` };
        }
    }

    // Desktop: 同期処理でダウンロード + X 投稿画面を新タブで開く
    // (デスクトップに X アプリ無し、画像は手動添付してもらう)
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

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'barrel.png';
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.open(buildXIntentUrl(X_POST_TEXT, shareUrl), '_blank', 'noopener,noreferrer');
    return { status: 'opened' };
};
