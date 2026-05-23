'use client';

import { useBarrelStore, OutlinePoint, OutlineInterp } from '@/lib/store/useBarrelStore';
import { NumStepper } from './Editor';

const MIN_DIAMETER = 4.0;
const MAX_DIAMETER = 10.0;

/**
 * アウトライン(バレル外形プロファイル)の制御点を編集する UI。
 * shapeType === 'custom' のとき Editor から表示される。
 *
 * 制御点: { z: 前端からの距離 mm, d: 直径 mm }[]
 * 補間方式: 'linear' (折れ線) | 'smooth' (Catmull-Rom スプライン) ※Phase 2 で generator 側実装
 */
export const OutlineEditor = () => {
    const length = useBarrelStore((s) => s.length);
    const outline = useBarrelStore((s) => s.outline);
    const outlineInterp = useBarrelStore((s) => s.outlineInterp);
    const setOutline = useBarrelStore((s) => s.setOutline);
    const setOutlineInterp = useBarrelStore((s) => s.setOutlineInterp);

    /** 制御点の更新。z で昇順ソート */
    const updatePoint = (index: number, patch: Partial<OutlinePoint>) => {
        const next = outline.map((p, i) => (i === index ? { ...p, ...patch } : p));
        next.sort((a, b) => a.z - b.z);
        setOutline(next);
    };

    /** 隣接 2 点の中間に新規点を挿入(最大ギャップを分割) */
    const addPoint = () => {
        if (outline.length < 2) {
            // 異常系: 2 点未満なら端点 + 中央点で初期化
            setOutline([
                { z: 0, d: 5.8 },
                { z: length / 2, d: 7.0 },
                { z: length, d: 5.8 },
            ]);
            return;
        }
        let maxGap = -1;
        let insertAt = 0;
        for (let i = 0; i < outline.length - 1; i++) {
            const gap = outline[i + 1].z - outline[i].z;
            if (gap > maxGap) {
                maxGap = gap;
                insertAt = i;
            }
        }
        const a = outline[insertAt];
        const b = outline[insertAt + 1];
        const newPoint: OutlinePoint = {
            z: (a.z + b.z) / 2,
            d: (a.d + b.d) / 2,
        };
        setOutline([
            ...outline.slice(0, insertAt + 1),
            newPoint,
            ...outline.slice(insertAt + 1),
        ]);
    };

    /** 制御点削除。最低 2 点は残す */
    const removePoint = (index: number) => {
        if (outline.length <= 2) return;
        setOutline(outline.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-3" data-testid="outline-editor">
            {/* 補間方式トグル */}
            <div>
                <label className="text-xs font-medium text-zinc-500 block mb-1.5">補間方式</label>
                <div className="grid grid-cols-2 gap-2">
                    {(['smooth', 'linear'] as OutlineInterp[]).map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            onClick={() => setOutlineInterp(mode)}
                            className={`py-2 rounded-lg border-2 text-xs font-bold transition-all ${
                                outlineInterp === mode
                                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600'
                                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 text-zinc-500'
                            }`}
                        >
                            {mode === 'smooth' ? '曲線 (流曲線)' : '直線 (折れ線)'}
                        </button>
                    ))}
                </div>
            </div>

            {/* 制御点リスト */}
            <div>
                <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-zinc-500">
                        制御点 ({outline.length})
                    </label>
                    <span className="text-[10px] text-zinc-400">前端: z=0 / 後端: z={length}</span>
                </div>

                {/* 列見出し */}
                <div className="grid grid-cols-[1fr_1fr_28px] gap-2 mb-1 text-[10px] text-zinc-400 px-1">
                    <span>位置 z (mm)</span>
                    <span>径 d (mm)</span>
                    <span />
                </div>

                <div className="space-y-1.5">
                    {outline.map((p, i) => {
                        const isEndpoint = i === 0 || i === outline.length - 1;
                        return (
                            <div
                                key={i}
                                className="grid grid-cols-[1fr_1fr_28px] gap-2 items-center"
                            >
                                <NumStepper
                                    value={p.z}
                                    onChange={(v) => updatePoint(i, { z: v })}
                                    step={0.5}
                                    min={0}
                                    max={length}
                                    className="w-full"
                                    inputClassName="text-xs"
                                    bg={isEndpoint ? 'bg-zinc-100 dark:bg-zinc-800' : 'bg-white dark:bg-zinc-900'}
                                />
                                <NumStepper
                                    value={p.d}
                                    onChange={(v) => updatePoint(i, { d: v })}
                                    step={0.1}
                                    min={MIN_DIAMETER}
                                    max={MAX_DIAMETER}
                                    className="w-full"
                                    inputClassName="text-xs"
                                />
                                <button
                                    type="button"
                                    onClick={() => removePoint(i)}
                                    disabled={outline.length <= 2}
                                    className="w-7 h-7 rounded text-zinc-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-zinc-400 flex items-center justify-center"
                                    aria-label="制御点を削除"
                                    title={outline.length <= 2 ? '最低 2 点必要' : '削除'}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        );
                    })}
                </div>

                <button
                    type="button"
                    onClick={addPoint}
                    className="mt-2 w-full py-2 border border-dashed border-zinc-300 dark:border-zinc-700 rounded text-xs text-zinc-500 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
                >
                    + 制御点を追加
                </button>
            </div>

            <p className="text-[10px] text-zinc-400 leading-tight">
                ヒント: 中央付近の制御点の径を小さくすると「くぼみ」、両端側を絞ると「砲弾型」になります。
            </p>
        </div>
    );
};
