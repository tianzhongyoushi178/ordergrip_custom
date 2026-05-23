'use client';

import { useRef, useState } from 'react';
import { useBarrelStore, OutlinePoint, OutlineInterp } from '@/lib/store/useBarrelStore';
import { NumStepper } from './Editor';

const MIN_DIAMETER = 4.0;
const MAX_DIAMETER = 10.0;

/** d(z) を Catmull-Rom (cubic Hermite) で補間。SVG プレビュー描画用 */
const interpolateD = (z: number, pts: OutlinePoint[], mode: OutlineInterp): number => {
    const n = pts.length;
    if (n === 0) return 0;
    if (z <= pts[0].z) return pts[0].d;
    if (z >= pts[n - 1].z) return pts[n - 1].d;
    let i = 0;
    for (let k = 0; k < n - 1; k++) {
        if (z >= pts[k].z && z <= pts[k + 1].z) { i = k; break; }
    }
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const dz = p1.z - p0.z;
    if (dz < 1e-9) return p0.d;
    const t = (z - p0.z) / dz;
    if (mode === 'linear' || n < 3) return p0.d + (p1.d - p0.d) * t;
    const m0 = i > 0
        ? (p1.d - pts[i - 1].d) / (p1.z - pts[i - 1].z)
        : (p1.d - p0.d) / dz;
    const m1 = i + 2 < n
        ? (pts[i + 2].d - p0.d) / (pts[i + 2].z - p0.z)
        : (p1.d - p0.d) / dz;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p0.d
        + (t3 - 2 * t2 + t) * dz * m0
        + (-2 * t3 + 3 * t2) * p1.d
        + (t3 - t2) * dz * m1;
};

// SVG viewBox 設定: 横は z [0, length] にマップ、縦は径 [0, MAX_DIAMETER] を反転表示
const SVG_W = 400;
const SVG_H = 140;
const SVG_PAD = 12;

/** プリセット定義 (z は length に対する比率 [0..1]、d は mm) */
type PresetDef = {
    key: string;
    label: string;
    points: { ratio: number; d: number }[];
};
const PRESETS: PresetDef[] = [
    {
        key: 'bullet',
        label: '砲弾',
        points: [
            { ratio: 0,    d: 5.8 },
            { ratio: 0.30, d: 7.0 },
            { ratio: 1,    d: 5.8 },
        ],
    },
    {
        key: 'waist',
        label: 'くびれ',
        points: [
            { ratio: 0,    d: 5.8 },
            { ratio: 0.20, d: 7.0 },
            { ratio: 0.50, d: 6.2 },
            { ratio: 0.80, d: 7.0 },
            { ratio: 1,    d: 5.8 },
        ],
    },
    {
        key: 'hourglass',
        label: '鼓型',
        points: [
            { ratio: 0,    d: 7.0 },
            { ratio: 0.25, d: 6.5 },
            { ratio: 0.50, d: 5.6 },
            { ratio: 0.75, d: 6.5 },
            { ratio: 1,    d: 7.0 },
        ],
    },
    {
        key: 'egg',
        label: '卵型',
        points: [
            { ratio: 0,    d: 5.8 },
            { ratio: 0.40, d: 7.2 },
            { ratio: 0.55, d: 7.2 },
            { ratio: 1,    d: 5.8 },
        ],
    },
];

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

    /** 前後対称ロック (ON のとき編集が中心 z=length/2 を境にミラーされる) */
    const [symmetric, setSymmetric] = useState(false);

    /** 対称鏡像化: 前半の編集を後半へ (および逆) ミラー反映した outline を返す */
    const mirroredOutline = (next: OutlinePoint[]): OutlinePoint[] => {
        const half = length / 2;
        // 前半の点 (z <= half) を z>half にミラーした点を生成、d は前半側の値
        const front = next.filter((p) => p.z <= half);
        const mirroredBack = front
            .filter((p) => p.z < half) // z = half の点は重複させない
            .map((p) => ({ z: length - p.z, d: p.d }));
        return [...front, ...mirroredBack].sort((a, b) => a.z - b.z);
    };

    /** 制御点の更新。z で昇順ソート。対称モード時は鏡像反映 */
    const updatePoint = (index: number, patch: Partial<OutlinePoint>) => {
        const updated = outline.map((p, i) => (i === index ? { ...p, ...patch } : p));
        updated.sort((a, b) => a.z - b.z);
        setOutline(symmetric ? mirroredOutline(updated) : updated);
    };

    /** プリセット適用: ratio を現在の length に展開して outline を置き換え */
    const applyPreset = (preset: PresetDef) => {
        const pts: OutlinePoint[] = preset.points.map(({ ratio, d }) => ({
            z: Math.round(ratio * length * 10) / 10,
            d,
        }));
        setOutline(pts);
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

    // --- SVG ドラッグ編集 ---
    const svgRef = useRef<SVGSVGElement>(null);
    const dragIdxRef = useRef<number | null>(null); // 同期的に参照する用
    const [dragIdx, setDragIdx] = useState<number | null>(null); // 描画用

    // SVG 座標 ⇄ outline 座標の変換
    const innerW = SVG_W - SVG_PAD * 2;
    const innerH = SVG_H - SVG_PAD * 2;
    const zToX = (z: number) => SVG_PAD + (z / Math.max(0.001, length)) * innerW;
    const dToY = (d: number) => SVG_PAD + (1 - d / MAX_DIAMETER) * innerH;
    const xToZ = (x: number) => ((x - SVG_PAD) / innerW) * length;
    const yToD = (y: number) => (1 - (y - SVG_PAD) / innerH) * MAX_DIAMETER;

    /** 連続プレビュー曲線用のサンプリング (40 ステップ程度で十分滑らか) */
    const samples = (() => {
        if (outline.length < 2) return [];
        const N = 80;
        const out: { x: number; y: number }[] = [];
        for (let i = 0; i <= N; i++) {
            const z = (i / N) * length;
            const d = interpolateD(z, outline, outlineInterp);
            out.push({ x: zToX(z), y: dToY(d) });
        }
        return out;
    })();

    const svgPointToOutline = (clientX: number, clientY: number) => {
        const svg = svgRef.current;
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * SVG_W;
        const y = ((clientY - rect.top) / rect.height) * SVG_H;
        return { z: xToZ(x), d: yToD(y) };
    };

    const onPointerDownPoint = (idx: number) => (e: React.PointerEvent<SVGCircleElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragIdxRef.current = idx; // 同期的に確定 (state は次レンダーまで反映されないため)
        setDragIdx(idx);
    };
    const onPointerMovePoint = (e: React.PointerEvent<SVGCircleElement>) => {
        const idx = dragIdxRef.current;
        if (idx === null) return;
        const p = svgPointToOutline(e.clientX, e.clientY);
        if (!p) return;
        // store の最新値を直接読む (closure の stale な outline/length を回避)
        const state = useBarrelStore.getState();
        const isFirst = idx === 0;
        const isLast = idx === state.outline.length - 1;
        const next: OutlinePoint = {
            z: isFirst ? 0 : isLast ? state.length : Math.min(state.length, Math.max(0, p.z)),
            d: Math.min(MAX_DIAMETER, Math.max(MIN_DIAMETER, p.d)),
        };
        // ドラッグ中はソートしない (idx の物理的な対応関係を維持)
        const newOutline = state.outline.map((pt, i) => (i === idx ? next : pt));
        state.setOutline(newOutline);
    };
    const onPointerUpPoint = (e: React.PointerEvent<SVGCircleElement>) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        dragIdxRef.current = null;
        setDragIdx(null);
        // ドラッグ終了時にソート + (必要なら) 対称反映
        const state = useBarrelStore.getState();
        const sorted = [...state.outline].sort((a, b) => a.z - b.z);
        state.setOutline(symmetric ? mirroredOutline(sorted) : sorted);
    };

    /** 対称ロックトグル: ON に切り替えた瞬間に現在の outline を対称化 */
    const toggleSymmetric = (on: boolean) => {
        setSymmetric(on);
        if (on) setOutline(mirroredOutline(outline));
    };

    return (
        <div className="space-y-3" data-testid="outline-editor">
            {/* SVG プレビュー: 制御点をドラッグして編集 */}
            <div className="bg-white dark:bg-zinc-950 rounded border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                    className="w-full h-auto touch-none select-none"
                    style={{ touchAction: 'none' }}
                >
                    {/* 中心線 */}
                    <line
                        x1={SVG_PAD} y1={dToY(0)} x2={SVG_W - SVG_PAD} y2={dToY(0)}
                        stroke="currentColor" strokeOpacity="0.15" strokeDasharray="2 2"
                    />
                    {/* 上下対称プロファイル塗りつぶし */}
                    {samples.length > 1 && (
                        <path
                            d={
                                'M ' + samples.map((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}`).join(' L ') +
                                ' L ' + samples.slice().reverse().map((s) => `${s.x.toFixed(2)},${(2 * dToY(0) - s.y).toFixed(2)}`).join(' L ') +
                                ' Z'
                            }
                            fill="rgb(99 102 241 / 0.15)"
                            stroke="rgb(99 102 241)"
                            strokeWidth="1.2"
                        />
                    )}
                    {/* 制御点 (上半分のみ) */}
                    {outline.map((p, i) => (
                        <circle
                            key={i}
                            cx={zToX(p.z)}
                            cy={dToY(p.d)}
                            r={dragIdx === i ? 7 : 5}
                            fill={dragIdx === i ? 'rgb(99 102 241)' : 'white'}
                            stroke="rgb(99 102 241)"
                            strokeWidth="2"
                            className="cursor-grab active:cursor-grabbing"
                            onPointerDown={onPointerDownPoint(i)}
                            onPointerMove={onPointerMovePoint}
                            onPointerUp={onPointerUpPoint}
                            onPointerCancel={onPointerUpPoint}
                        />
                    ))}
                </svg>
                <div className="text-[10px] text-zinc-400 px-2 pb-1.5 text-center">
                    制御点をドラッグで編集 (前後端は z 固定・径のみ)
                </div>
            </div>
            {/* プリセット */}
            <div>
                <label className="text-xs font-medium text-zinc-500 block mb-1.5">プリセット</label>
                <div className="grid grid-cols-4 gap-1.5">
                    {PRESETS.map((p) => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => applyPreset(p)}
                            className="py-1.5 rounded text-xs font-bold border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 補間方式 & 対称ロック */}
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
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
                                {mode === 'smooth' ? '曲線' : '直線'}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => toggleSymmetric(!symmetric)}
                    className={`px-3 py-2 rounded-lg border-2 text-xs font-bold transition-all ${
                        symmetric
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600'
                            : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 text-zinc-500'
                    }`}
                    title="前後対称: 前半の編集を後半にミラーする"
                    aria-pressed={symmetric}
                >
                    前後対称{symmetric ? ' ✓' : ''}
                </button>
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
