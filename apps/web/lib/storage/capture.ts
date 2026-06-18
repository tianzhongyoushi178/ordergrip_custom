/**
 * 3D Canvas のバレルを PNG Blob としてキャプチャする共通ユーティリティ。
 * Scene.tsx で `preserveDrawingBuffer: true` を設定済みのため canvas.toDataURL() が機能する。
 * X 共有 (share-x.ts) と LINE 相談 (dxf.ts shareDxf) で共用する。
 */

import { useBarrelStore } from '@/lib/store/useBarrelStore';

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

/**
 * 描画完了を待つ。triggerCameraReset → React コミット → Scene の effect(camera.update)
 * → R3F 再描画 を確実に跨ぐため数フレーム + 余白で待つ。RAF 不在時は setTimeout で代替。
 */
export const waitForRender = (): Promise<void> => new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame === 'undefined') {
        setTimeout(resolve, 80);
        return;
    }
    let n = 0;
    const tick = () => {
        if (++n >= 3) setTimeout(resolve, 16);
        else window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
});

/**
 * キャプチャ前にカメラを既定アイソメ視点へ戻し、描画完了を待つ。
 * X 投稿・LINE 相談の共有画像を、ユーザーの現在の視点 (真横等) に依存させず
 * 常に既定アイソメで撮るために使う。リセット失敗時もキャプチャは続行する。
 */
export const resetToDefaultViewAndWait = async (): Promise<void> => {
    try {
        useBarrelStore.getState().triggerCameraReset();
        await waitForRender();
    } catch {
        // リセットに失敗してもキャプチャは続行する
    }
};
