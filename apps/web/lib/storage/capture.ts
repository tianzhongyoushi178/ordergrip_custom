/**
 * 3D Canvas のバレルを PNG Blob としてキャプチャする共通ユーティリティ。
 * Scene.tsx で `preserveDrawingBuffer: true` を設定済みのため canvas.toDataURL() が機能する。
 * X 共有 (share-x.ts) と LINE 相談 (dxf.ts shareDxf) で共用する。
 */

/** dataURL (data:image/png;base64,xxx) を同期で Blob に変換 */
export const dataUrlToBlobSync = (dataUrl: string): Blob => {
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

/**
 * 3D Canvas を PNG Blob で取得する。canvas 不在 / 空 / 取得失敗時は null を返す
 * (呼び出し側は画像なしでも処理を続行できるようにする)。
 */
export const captureBarrelPngBlob = (): Blob | null => {
    if (typeof document === 'undefined') return null;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) return null;
    let dataUrl: string;
    try {
        dataUrl = canvas.toDataURL('image/png');
    } catch {
        return null;
    }
    if (!dataUrl || dataUrl === 'data:,') return null;
    return dataUrlToBlobSync(dataUrl);
};
