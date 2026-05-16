'use client';

import { useBarrelStore, CutType } from '@/lib/store/useBarrelStore';
import { generateProfile } from '@/lib/math/generator';
import { calculatePhysics } from '@/lib/math/physics';
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { exportToDxf, shareDxf, OFFICIAL_LINE_URL } from '@/lib/storage/dxf';
import { PDFUploader } from './PDFUploader';
import { SpecWizard } from './SpecWizard';
import { CutSelector, type CutParams } from './CutSelector';

/** 数値入力: フォーカス中はローカルstate、blur/Enterで確定 */
const NumInput = ({ value, onChange, className, ...rest }: {
    value: number;
    onChange: (v: number) => void;
    className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) => {
    const [local, setLocal] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const commit = useCallback(() => {
        if (local === null) return;
        const parsed = parseFloat(local);
        if (!isNaN(parsed)) onChange(parsed);
        setLocal(null);
    }, [local, onChange]);

    return (
        <input
            ref={ref}
            type="text"
            inputMode="decimal"
            className={className}
            value={local ?? (Number.isInteger(value) ? String(value) : parseFloat(value.toFixed(2)).toString())}
            onFocus={() => setLocal(Number.isInteger(value) ? String(value) : parseFloat(value.toFixed(2)).toString())}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { commit(); ref.current?.blur(); } }}
            {...rest}
        />
    );
};

/** +/- ボタン付き数値入力 */
const NumStepper = ({
    value,
    onChange,
    step = 0.1,
    min,
    max,
    integer = false,
    className = '',
    inputClassName = '',
    bg = 'bg-white dark:bg-zinc-900',
}: {
    value: number;
    onChange: (v: number) => void;
    step?: number;
    min?: number;
    max?: number;
    integer?: boolean;
    className?: string;
    inputClassName?: string;
    bg?: string;
}) => {
    const [local, setLocal] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const clamp = useCallback((v: number): number => {
        let next = v;
        if (integer) next = Math.round(next);
        if (min !== undefined && next < min) next = min;
        if (max !== undefined && next > max) next = max;
        return integer ? next : Math.round(next * 1000) / 1000;
    }, [integer, min, max]);

    const commit = useCallback(() => {
        if (local === null) return;
        const parsed = parseFloat(local);
        if (!isNaN(parsed)) onChange(clamp(parsed));
        setLocal(null);
    }, [local, onChange, clamp]);

    const adjust = useCallback((delta: number) => {
        const base = local !== null && !isNaN(parseFloat(local)) ? parseFloat(local) : value;
        onChange(clamp(base + delta));
        setLocal(null);
    }, [local, value, onChange, clamp]);

    const display = local ?? (Number.isInteger(value) ? String(value) : parseFloat(value.toFixed(2)).toString());

    return (
        <div className={`flex items-stretch border border-zinc-200 dark:border-zinc-700 rounded overflow-hidden ${bg} ${className}`}>
            <button
                type="button"
                onClick={() => adjust(-step)}
                onMouseDown={(e) => e.preventDefault()}
                className="px-1.5 shrink-0 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-white text-base font-bold select-none border-r border-zinc-200 dark:border-zinc-700 leading-none"
                aria-label="減らす"
                tabIndex={-1}
            >
                −
            </button>
            <input
                ref={ref}
                type="text"
                inputMode="decimal"
                className={`flex-1 min-w-0 w-full p-1 text-right text-sm font-bold bg-transparent outline-none ${inputClassName}`}
                value={display}
                onFocus={() => setLocal(display)}
                onChange={(e) => setLocal(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') { commit(); ref.current?.blur(); } }}
            />
            <button
                type="button"
                onClick={() => adjust(step)}
                onMouseDown={(e) => e.preventDefault()}
                className="px-1.5 shrink-0 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-white text-base font-bold select-none border-l border-zinc-200 dark:border-zinc-700 leading-none"
                aria-label="増やす"
                tabIndex={-1}
            >
                +
            </button>
        </div>
    );
};

// Simple implementation without extra deps for now
export const Editor = () => {
    const {
        length, maxDiameter, materialDensity, cuts,
        frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear, outline,
        shapeType, frontEndShape, rearEndShape,
        updateDimension, updateShapeType, updateEndShape, addCut, removeCut, updateCut,
        setAll, setMaterialDensity, activeCutId, setActiveCutId
    } = useBarrelStore();

    const [showWizard, setShowWizard] = useState(true);

    // Add physics dependencies
    const physics = useMemo(() => {
        const points = generateProfile(length, maxDiameter, cuts, frontTaperLength, rearTaperLength, outline, frontEndShape, rearEndShape);
        return calculatePhysics(points, materialDensity, holeDepthFront, holeDepthRear);
    }, [length, maxDiameter, cuts, frontTaperLength, rearTaperLength, materialDensity, holeDepthFront, holeDepthRear, outline, frontEndShape, rearEndShape]);

    // Mobile toggle removed for split view
    // const [isMobileOpen, setIsMobileOpen] = useState(false);

    // Collision check helper
    const checkCollision = (id: string | null, start: number, end: number, type: string): boolean => {
        // Vertical cuts can overlap anything.
        if (type === 'vertical') return false;

        return cuts.some(c => {
            if (c.id === id) return false;
            // Existing vertical cuts don't block
            if (c.type === 'vertical') return false;

            // Overlap condition
            return (end > c.startZ && start < c.endZ);
        });
    };

    // --- Cut parameter helpers ---
    type CutZoneRef = { type: CutType; properties: { cutWidth?: number; gapWidth?: number; pitch?: number } };

    /** 1ピッチ内のアクティブ幅（溝部分の合計） */
    const getActiveWidth = (cut: CutZoneRef): number => {
        const pitch = cut.properties.pitch || 1.0;
        const cw = cut.properties.cutWidth ?? pitch;
        const gw = cut.properties.gapWidth ?? 0;
        if (cut.type === 'ring_double') return 2 * cw + gw;
        if (cut.type === 'ring_triple') return 3 * cw + 2 * gw;
        return cw;
    };

    /** 溝間隔（ランド幅） */
    const getSpacing = (cut: CutZoneRef): number =>
        Math.max(0, (cut.properties.pitch || 1.0) - getActiveWidth(cut));

    /** カット数 */
    const getCount = (startZ: number, endZ: number, pitch: number): number =>
        Math.max(1, Math.round((endZ - startZ) / pitch));

    /** activeWidth + spacing → pitch, count → endZ */
    const recalc = (startZ: number, activeWidth: number, spacing: number, count: number) => {
        const pitch = Math.max(0.1, activeWidth + spacing);
        const endZ = startZ + count * pitch;
        return { pitch, endZ };
    };

    // --- Default cut properties per type ---
    // pitch≒2.0を基準に、初期状態でパターンの違いが視覚的にわかるサイズ
    const defaultProps = (type: CutType): { cutWidth: number; depth: number; spacing: number; count: number; gapWidth?: number; itemCount?: number } => {
        switch (type) {
            case 'ring':       return { cutWidth: 1.0, depth: 0.3, spacing: 1.0, count: 5 };
            case 'ring_double': return { cutWidth: 0.5, depth: 0.3, spacing: 0.6, count: 5, gapWidth: 0.4 };
            case 'ring_triple': return { cutWidth: 0.4, depth: 0.3, spacing: 0.4, count: 5, gapWidth: 0.2 };
            case 'ring_r':     return { cutWidth: 2.0, depth: 0.3, spacing: 0, count: 5 };
            case 'ring_v':     return { cutWidth: 2.0, depth: 0.3, spacing: 0, count: 5 };
            case 'canyon':     return { cutWidth: 2.0, depth: 0.4, spacing: 0, count: 5 };
            case 'shark':      return { cutWidth: 2.0, depth: 0.4, spacing: 0, count: 5 };
            case 'wing':       return { cutWidth: 1.0, depth: 0.4, spacing: 1.0, count: 5 };
            case 'step':       return { cutWidth: 2.0, depth: 0.4, spacing: 0, count: 5 };
            case 'stair':      return { cutWidth: 2.0, depth: 0.4, spacing: 0, count: 5 };
            case 'scallop':    return { cutWidth: 2.0, depth: 0.4, spacing: 0, count: 5 };
            case 'micro':      return { cutWidth: 0.5, depth: 0.15, spacing: 0.5, count: 10 };
            case 'vertical':   return { cutWidth: 1.0, depth: 0.5, spacing: 0, count: 1, itemCount: 12 };
            default:           return { cutWidth: 1.0, depth: 0.3, spacing: 1.0, count: 5 };
        }
    };

    const addBasicCut = (type: CutType, userParams?: CutParams) => {
        const d = defaultProps(type);
        // ユーザー指定パラメータでデフォルトを上書き
        const cutWidth = userParams?.cutWidth ?? d.cutWidth;
        const depth = userParams?.depth ?? d.depth;
        const spacing = userParams?.spacing ?? d.spacing;
        const count = userParams?.count ?? d.count;
        const gapWidth = userParams?.gapWidth ?? d.gapWidth;
        const itemCount = userParams?.itemCount ?? d.itemCount;

        // Compute active width for double/triple
        let activeWidth = cutWidth;
        if (type === 'ring_double') activeWidth = 2 * cutWidth + (gapWidth ?? 0);
        else if (type === 'ring_triple') activeWidth = 3 * cutWidth + 2 * (gapWidth ?? 0);

        const { pitch, endZ: zoneLen } = recalc(0, activeWidth, spacing, count);
        const center = length / 2;
        let start = Math.max(0, center - zoneLen / 2);
        let end = start + zoneLen;

        // Find free spot if colliding
        if (checkCollision(null, start, end, type)) {
            // ギャップ探索: 既存の非縦カット領域をソートし、隙間に zoneLen が収まる最初の位置を見つける
            // 整数刻み探索だと端数の境界を見逃すため、隙間を直接見つける方式に変更
            const GAP_EPSILON = 1e-6;
            const occupied = cuts
                .filter((c) => c.type !== 'vertical')
                .map((c) => ({ start: c.startZ, end: c.endZ }))
                .sort((a, b) => a.start - b.start);

            let foundStart: number | null = null;
            let cursor = 0;
            for (const seg of occupied) {
                if (seg.start - cursor >= zoneLen - GAP_EPSILON) {
                    foundStart = cursor;
                    break;
                }
                cursor = Math.max(cursor, seg.end);
            }
            // 末尾ギャップ
            if (foundStart === null && length - cursor >= zoneLen - GAP_EPSILON) {
                foundStart = cursor;
            }

            if (foundStart === null) {
                alert('空きスペースが見つかりませんでした。既存のカットを調整してください。');
                return;
            }
            start = foundStart;
            end = foundStart + zoneLen;
        }

        addCut({
            id: Math.random().toString(36).substr(2, 9),
            type,
            startZ: start,
            endZ: end,
            properties: {
                pitch,
                depth,
                cutWidth,
                ...(gapWidth !== undefined && { gapWidth }),
                ...(itemCount !== undefined && { itemCount }),
            }
        });
    };

    return (
        <div
            data-testid="editor-panel"
            className={`
                z-20 bg-white/95 dark:bg-zinc-900/95 backdrop-blur shadow-xl
                /* Mobile: Absolute Bottom Sheet, 60% height */
                absolute bottom-0 w-full h-[60dvh] rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.1)]
                /* Desktop: Absolute Sidebar, Full Height */
                md:top-0 md:right-0 md:h-full md:w-80 md:border-l md:border-zinc-200 md:dark:border-zinc-800 md:rounded-none
                border-t border-zinc-200 dark:border-zinc-800
            `}
            style={{
                paddingBottom: 'env(safe-area-inset-bottom)',
            }}
        >
            {/* Scrollable Content */}
            <div className="overflow-y-auto h-full px-4 sm:px-6 py-6 pb-24 md:pb-6 overscroll-contain">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-xl font-bold">バレルスペック設定</h1>
                    <button
                        onClick={() => setShowWizard(true)}
                        className="text-[10px] bg-zinc-200 dark:bg-zinc-800 px-2 py-1 rounded hover:opacity-80 transition-opacity"
                    >
                        再ヒアリング
                    </button>
                </div>

                {/* Wizard Overlay */}
                {showWizard && (
                    <SpecWizard
                        onComplete={() => setShowWizard(false)}
                        onCancel={() => setShowWizard(false)}
                    />
                )}

                {/* PDF Import */}
                <PDFUploader onApply={(specs) => {
                    // 1. Basic Dimensions
                    if (specs.length) updateDimension('length', specs.length);
                    if (specs.maxDiameter) updateDimension('maxDiameter', specs.maxDiameter);
                    if (specs.frontTaperLength) updateDimension('frontTaperLength', specs.frontTaperLength);
                    if (specs.rearTaperLength) updateDimension('rearTaperLength', specs.rearTaperLength);

                    // 2. Clear existing cuts if AI found new ones
                    if (specs.cuts && specs.cuts.length > 0) {
                        // We would need a clearCuts() method in store, but we can do setAll or just remove all manually?
                        // Ideally we have setAll() or we can iterate. 
                        // Let's assume we want to purely REPLACE.
                        // However, setAll requires full state. 
                        // Let's implement a simple loop to remove current cuts first? 
                        // Or better: updateDimension only updates dimensions. 

                        // We will use cuts directly.
                        // First, we need to map the cut types to our valid types.
                        const validTypes = ["ring", "ring_double", "ring_triple", "ring_r", "ring_v", "canyon", "scallop", "shark", "wing", "step", "stair", "micro", "vertical"];

                        const newCuts = specs.cuts.map(c => {
                            // Validate type
                            let type = c.type;
                            if (!validTypes.includes(type)) type = 'ring'; // Fallback

                            return {
                                id: Math.random().toString(36).substr(2, 9),
                                type: type as CutType,
                                startZ: c.startZ,
                                endZ: c.endZ,
                                properties: {
                                    pitch: c.properties?.pitch || 1.0,
                                    depth: c.properties?.depth || 0.5,
                                    itemCount: 12 // Default for vertical
                                }
                            };
                        });

                        // We can use a special function or just hack it by clearing first.
                        // Since we don't have setCuts exported, we might need to modify the store or just use setAll with current values + new cuts.
                        // But we don't have access to current state inside this callback easily unless we use the store values we destructured.
                        // We destructured `length`, `maxDiameter` etc. but those are values at render time. They are fine.

                        // Let's fetch current state from store or just construct a new object for setAll?
                        // Actually, Editor has access to `setAll`.
                        setAll({
                            length: specs.length || length,
                            maxDiameter: specs.maxDiameter || maxDiameter,
                            materialDensity: materialDensity, // Keep current
                            frontTaperLength: specs.frontTaperLength || frontTaperLength,
                            rearTaperLength: specs.rearTaperStartZ
                                ? (specs.length || length) - specs.rearTaperStartZ
                                : (specs.rearTaperLength || rearTaperLength),
                            holeDepthFront: holeDepthFront, // Keep
                            holeDepthRear: holeDepthRear, // Keep
                            outline: specs.outline || [],
                            cuts: newCuts
                        });
                    }
                }} />

                {/* Specs Panel */}
                <div className="mb-6 bg-zinc-100 dark:bg-zinc-800 p-4 rounded-lg">
                    <h2 className="text-xs font-semibold text-zinc-500 mb-2 tracking-wider">バレルスペック設定</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <div className="text-xs text-zinc-500">重量</div>
                            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{physics.weight.toFixed(2)}<span className="text-sm text-zinc-500 ml-1">g</span></div>
                        </div>
                        <div>
                            <div className="text-xs text-zinc-500">重心 (前側から)</div>
                            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{physics.centerOfGravity.toFixed(1)}<span className="text-sm text-zinc-500 ml-1">mm</span></div>
                        </div>
                    </div>
                </div>

                {/* Material & Tapers */}
                <div className="space-y-6 mb-8 border-b border-zinc-200 dark:border-zinc-800 pb-8">
                    <div>
                        <label className="text-sm font-medium mb-2 block">素材</label>
                        <select
                            value={materialDensity}
                            onChange={(e) => setMaterialDensity(parseFloat(e.target.value))}
                            className="w-full p-2 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700 text-sm"
                        >
                            <option value={18.0}>タングステン95% (18.0g/cm³)</option>
                            <option value={17.0}>タングステン90% (17.0g/cm³)</option>
                            <option value={15.0}>タングステン80% (15.0g/cm³)</option>
                            <option value={13.5}>タングステン70% (13.5g/cm³)</option>
                        </select>
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-2 block">基本形状</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => updateShapeType('torpedo')}
                                className={`
                                    py-3 rounded-lg border-2 font-bold transition-all
                                    ${shapeType === 'torpedo'
                                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-600'
                                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'}
                                `}
                            >
                                <div className="text-sm">トルピード</div>
                                <div className="text-[10px] font-normal opacity-60">緩やかな絞り込み</div>
                            </button>
                            <button
                                onClick={() => updateShapeType('straight')}
                                className={`
                                    py-3 rounded-lg border-2 font-bold transition-all
                                    ${shapeType === 'straight'
                                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-600'
                                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'}
                                `}
                            >
                                <div className="text-sm">ストレート</div>
                                <div className="text-[10px] font-normal opacity-60">直線的なアウトライン</div>
                            </button>
                        </div>
                    </div>

                    <details className="group">
                        <summary className="text-xs font-medium text-zinc-500 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors list-none flex items-center gap-1">
                            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                            詳細な形状設定 (テーパー長)
                        </summary>
                        <div className="space-y-6 pt-4 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-sm font-medium">前端 (チップ側) 形状</label>
                                    <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded p-0.5">
                                        {(['taper', 'round', 'convex'] as const).map((s) => (
                                            <button
                                                key={s}
                                                type="button"
                                                onClick={() => updateEndShape('front', s)}
                                                className={`px-2.5 py-1 text-xs rounded font-bold transition-colors ${
                                                    frontEndShape === s
                                                        ? 'bg-blue-600 text-white'
                                                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                                                }`}
                                            >
                                                {s === 'taper' ? 'テーパー' : s === 'round' ? '凹R' : '凸R'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-xs text-zinc-500">{frontEndShape !== 'taper' ? 'R長さ' : 'フロントテーパー終了位置'}</label>
                                    <div className="flex items-center gap-1">
                                        <NumStepper
                                            value={frontTaperLength}
                                            onChange={(v) => updateDimension('frontTaperLength', v)}
                                            step={0.5} min={0} max={length}
                                            className="w-28"
                                            bg="bg-transparent"
                                        />
                                        <span className="text-sm font-bold">mm</span>
                                    </div>
                                </div>
                                <input
                                    type="range" min="0" max={length} step="0.5"
                                    value={frontTaperLength}
                                    onChange={(e) => updateDimension('frontTaperLength', parseFloat(e.target.value))}
                                    className="w-full accent-blue-600"
                                />
                            </div>

                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-sm font-medium">後端 (シャフト側) 形状</label>
                                    <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded p-0.5">
                                        {(['taper', 'round', 'convex'] as const).map((s) => (
                                            <button
                                                key={s}
                                                type="button"
                                                onClick={() => updateEndShape('rear', s)}
                                                className={`px-2.5 py-1 text-xs rounded font-bold transition-colors ${
                                                    rearEndShape === s
                                                        ? 'bg-blue-600 text-white'
                                                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                                                }`}
                                            >
                                                {s === 'taper' ? 'テーパー' : s === 'round' ? '凹R' : '凸R'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-xs text-zinc-500">{rearEndShape !== 'taper' ? 'R長さ' : 'リアテーパー開始位置'}</label>
                                    <div className="flex items-center gap-1">
                                        <NumStepper
                                            value={parseFloat((rearEndShape !== 'taper' ? rearTaperLength : (length - rearTaperLength)).toFixed(1))}
                                            onChange={(v) => updateDimension('rearTaperLength', rearEndShape !== 'taper' ? v : length - v)}
                                            step={0.5} min={0} max={length}
                                            className="w-28"
                                            bg="bg-transparent"
                                        />
                                        <span className="text-sm font-bold">mm</span>
                                    </div>
                                </div>
                                <input
                                    type="range" min="0" max={length} step="0.5"
                                    value={rearEndShape !== 'taper' ? rearTaperLength : (length - rearTaperLength)}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        updateDimension('rearTaperLength', rearEndShape !== 'taper' ? val : length - val);
                                    }}
                                    className="w-full accent-blue-600"
                                />
                            </div>
                        </div>
                    </details>

                    {/* Hole Depths */}
                    <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-zinc-500">前穴 (チップ側)</label>
                            <NumStepper
                                value={holeDepthFront}
                                onChange={(v) => updateDimension('holeDepthFront', v)}
                                step={0.5} min={0} max={30}
                                className="w-full"
                                bg="bg-zinc-50 dark:bg-zinc-800"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-zinc-500">後穴 (シャフト側)</label>
                            <NumStepper
                                value={holeDepthRear}
                                onChange={(v) => updateDimension('holeDepthRear', v)}
                                step={0.5} min={0} max={30}
                                className="w-full"
                                bg="bg-zinc-50 dark:bg-zinc-800"
                            />
                        </div>
                    </div>
                </div>

                {/* Basic Dimensions */}
                <div className="space-y-6 mb-8">
                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium">全長</label>
                            <div className="flex items-center gap-1">
                                <NumStepper
                                    value={length}
                                    onChange={(v) => updateDimension('length', v)}
                                    step={0.5} min={20} max={150}
                                    className="w-28"
                                    bg="bg-transparent"
                                />
                                <span className="text-sm font-bold">mm</span>
                            </div>
                        </div>
                        <input
                            type="range" min="20" max="150" step="0.5"
                            value={length}
                            onChange={(e) => updateDimension('length', parseFloat(e.target.value))}
                            className="w-full accent-blue-600"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium">最大径</label>
                            <div className="flex items-center gap-1">
                                <NumStepper
                                    value={maxDiameter}
                                    onChange={(v) => updateDimension('maxDiameter', v)}
                                    step={0.1} min={5.5} max={8.5}
                                    className="w-28"
                                    bg="bg-transparent"
                                />
                                <span className="text-sm font-bold">mm</span>
                            </div>
                        </div>
                        <input
                            type="range" min="5.5" max="8.5" step="0.1"
                            value={maxDiameter}
                            onChange={(e) => updateDimension('maxDiameter', parseFloat(e.target.value))}
                            className="w-full accent-blue-600"
                        />
                    </div>
                </div>

                {/* Cuts */}
                <div className="mb-0">
                    <div className="flex justify-between items-center mb-2">
                        <h2 className="text-xs font-bold tracking-wider text-zinc-500">カット追加</h2>
                    </div>

                    <div className="mb-6">
                        <CutSelector onSelect={(type, params) => addBasicCut(type, params)} />
                    </div>
                    <div className="space-y-3 pb-8">
                        {cuts.length === 0 && (
                            <div className="text-xs text-zinc-400 italic text-center py-4 border border-dashed border-zinc-300 rounded">カットが追加されていません</div>
                        )}
                        {[...cuts].reverse().map(cut => {
                            const pitch = cut.properties.pitch || 1.0;
                            const curCutWidth = cut.properties.cutWidth ?? pitch;
                            const curSpacing = getSpacing(cut);
                            const curCount = getCount(cut.startZ, cut.endZ, pitch);
                            const curDepth = cut.properties.depth || 0.5;
                            const isVertical = cut.type === 'vertical';

                            /** 溝幅/間隔/カット数の変更時にpitchとendZを再計算してストアを更新 */
                            const updateDerived = (nextCutWidth: number, nextSpacing: number, nextCount: number, extraProps?: Record<string, number>) => {
                                // extraPropsにgapWidthが含まれていればそちらを優先（stale値回避）
                                const effectiveGap = extraProps?.gapWidth ?? (cut.properties.gapWidth ?? 0);
                                let aw = nextCutWidth;
                                if (cut.type === 'ring_double') aw = 2 * nextCutWidth + effectiveGap;
                                else if (cut.type === 'ring_triple') aw = 3 * nextCutWidth + 2 * effectiveGap;
                                const { pitch: newPitch, endZ: newEnd } = recalc(cut.startZ, aw, nextSpacing, nextCount);
                                if (newEnd > length || checkCollision(cut.id, cut.startZ, newEnd, cut.type)) {
                                    // カット数を自動で切り詰めて収まる範囲に調整
                                    const maxCount = Math.max(1, Math.floor((length - cut.startZ) / newPitch));
                                    const { pitch: clampedPitch, endZ: clampedEnd } = recalc(cut.startZ, aw, nextSpacing, maxCount);
                                    if (maxCount < 1 || checkCollision(cut.id, cut.startZ, clampedEnd, cut.type)) return;
                                    updateCut(cut.id, {
                                        endZ: clampedEnd,
                                        properties: { ...cut.properties, pitch: clampedPitch, cutWidth: nextCutWidth, ...extraProps }
                                    });
                                    return;
                                }
                                updateCut(cut.id, {
                                    endZ: newEnd,
                                    properties: { ...cut.properties, pitch: newPitch, cutWidth: nextCutWidth, ...extraProps }
                                });
                            };

                            return (
                            <div
                                key={cut.id}
                                className={`p-3 border-2 rounded relative group transition-colors ${
                                    activeCutId === cut.id
                                        ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20'
                                        : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50'
                                }`}
                                onPointerEnter={() => setActiveCutId(cut.id)}
                                onPointerLeave={() => { if (activeCutId === cut.id) setActiveCutId(null); }}
                                onFocusCapture={() => setActiveCutId(cut.id)}
                            >
                                <button
                                    onClick={() => removeCut(cut.id)}
                                    className="absolute top-2 right-2 text-zinc-400 hover:text-red-500"
                                    title="削除"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                                <select
                                    value={cut.type}
                                    onChange={(e) => updateCut(cut.id, { type: e.target.value as CutType })}
                                    className="mb-3 text-xs font-bold uppercase bg-transparent border-none p-0 cursor-pointer focus:ring-0 text-zinc-500"
                                >
                                    <option value="ring">リングカット</option>
                                    <option value="ring_double">ダブルリング</option>
                                    <option value="ring_triple">トリプルリング</option>
                                    <option value="ring_r">Rリングカット</option>
                                    <option value="ring_v">Vリングカット</option>
                                    <option value="canyon">キャニオンカット</option>
                                    <option value="scallop">スカラップカット</option>
                                    <option value="shark">シャークカット</option>
                                    <option value="wing">ウィングカット</option>
                                    <option value="step">ステップカット</option>
                                    <option value="stair">ステアカット</option>
                                    <option value="micro">マイクロカット</option>
                                    <option value="vertical">縦カット</option>
                                </select>

                                <div className="space-y-3">
                                    {/* 開始位置 */}
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs text-zinc-500">開始位置</span>
                                            <NumStepper
                                                value={parseFloat(cut.startZ.toFixed(1))}
                                                onChange={(v) => {
                                                    const zoneLen = cut.endZ - cut.startZ;
                                                    const newEnd = v + zoneLen;
                                                    if (!checkCollision(cut.id, v, newEnd, cut.type) && newEnd <= length) {
                                                        updateCut(cut.id, { startZ: v, endZ: newEnd });
                                                    }
                                                }}
                                                step={0.5} min={0} max={length}
                                                className="w-24"
                                                inputClassName="text-xs"
                                                bg="bg-transparent"
                                            />
                                        </div>
                                        <input
                                            type="range"
                                            min={0} max={length} step={0.5}
                                            value={cut.startZ}
                                            onChange={(e) => {
                                                const newStart = parseFloat(e.target.value);
                                                const zoneLen = cut.endZ - cut.startZ;
                                                const newEnd = newStart + zoneLen;
                                                if (newEnd > length) return;
                                                if (checkCollision(cut.id, newStart, newEnd, cut.type)) return;
                                                updateCut(cut.id, { startZ: newStart, endZ: newEnd });
                                            }}
                                            className="w-full h-1 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-zinc-500"
                                        />
                                    </div>

                                    {/* メインパラメータ 2x2 グリッド */}
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2 border-t border-dashed border-zinc-200 dark:border-zinc-700/50">
                                        {isVertical ? (
                                            <>
                                                {/* 縦カット: 本数 + 溝深さ */}
                                                <div>
                                                    <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-1">
                                                        <span>本数</span>
                                                    </div>
                                                    <NumStepper
                                                        value={cut.properties.itemCount || 12}
                                                        onChange={(v) => updateCut(cut.id, { properties: { ...cut.properties, itemCount: Math.round(v) } })}
                                                        step={1} integer min={1}
                                                        className="w-full"
                                                    />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-1">
                                                        <span>溝深さ</span>
                                                        <span className="text-zinc-400">mm</span>
                                                    </div>
                                                    <NumStepper
                                                        value={curDepth}
                                                        onChange={(v) => updateCut(cut.id, { properties: { ...cut.properties, depth: v } })}
                                                        step={0.05} min={0}
                                                        className="w-full"
                                                    />
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                {/* 通常カット: 溝幅 / 溝深さ / 溝間隔 / カット数 */}
                                                <div>
                                                    <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-1">
                                                        <span>溝幅</span>
                                                        <span className="text-zinc-400">mm</span>
                                                    </div>
                                                    <NumStepper
                                                        value={curCutWidth}
                                                        onChange={(v) => updateDerived(v, curSpacing, curCount)}
                                                        step={0.1} min={0.1}
                                                        className="w-full"
                                                    />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-1">
                                                        <span>溝深さ</span>
                                                        <span className="text-zinc-400">mm</span>
                                                    </div>
                                                    <NumStepper
                                                        value={curDepth}
                                                        onChange={(v) => updateCut(cut.id, { properties: { ...cut.properties, depth: v } })}
                                                        step={0.05} min={0}
                                                        className="w-full"
                                                    />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-1">
                                                        <span>溝間隔</span>
                                                        <span className="text-zinc-400">mm</span>
                                                    </div>
                                                    <NumStepper
                                                        value={curSpacing}
                                                        onChange={(v) => updateDerived(curCutWidth, v, curCount)}
                                                        step={0.1} min={0}
                                                        className="w-full"
                                                    />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-1">
                                                        <span>カット数</span>
                                                    </div>
                                                    <NumStepper
                                                        value={curCount}
                                                        onChange={(v) => updateDerived(curCutWidth, curSpacing, Math.round(v))}
                                                        step={1} integer min={1}
                                                        className="w-full"
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* --- 追加パラメータ --- */}
                                    {/* Double/Triple Ring: サブ溝間隔 (gapWidth) */}
                                    {(cut.type === 'ring_double' || cut.type === 'ring_triple') && (
                                        <div className="pt-2 border-t border-dashed border-zinc-200 dark:border-zinc-700/50">
                                            <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-1">
                                                <span>サブ溝間隔</span>
                                                <span className="text-zinc-400">mm</span>
                                            </div>
                                            <NumStepper
                                                value={cut.properties.gapWidth ?? 0.1}
                                                onChange={(v) => updateDerived(curCutWidth, curSpacing, curCount, { gapWidth: v })}
                                                step={0.1} min={0}
                                                className="w-full"
                                            />
                                        </div>
                                    )}
                                    {/* Vertical: 追加パラメータ */}
                                    {isVertical && (
                                        <div className="pt-2 border-t border-dashed border-zinc-200 dark:border-zinc-700/50 space-y-3">
                                            {/* 終了位置（溝長さ） */}
                                            <div>
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-xs text-zinc-500">終了位置</span>
                                                    <NumStepper
                                                        value={cut.endZ}
                                                        onChange={(v) => updateCut(cut.id, { endZ: v })}
                                                        step={0.5} min={cut.startZ + 1} max={length}
                                                        className="w-24"
                                                        inputClassName="text-xs"
                                                        bg="bg-transparent"
                                                    />
                                                </div>
                                                <input
                                                    type="range"
                                                    min={cut.startZ + 1} max={length} step={0.5}
                                                    value={cut.endZ}
                                                    onChange={(e) => updateCut(cut.id, { endZ: parseFloat(e.target.value) })}
                                                    className="w-full h-1 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-zinc-500"
                                                />
                                            </div>

                                            {/* 溝幅比率 */}
                                            <div>
                                                <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-1">
                                                    <span>溝幅比率</span>
                                                    <span className="text-zinc-400">{Math.round((cut.properties.grooveFraction ?? 0.5) * 100)}%</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min={0.1} max={0.9} step={0.05}
                                                    value={cut.properties.grooveFraction ?? 0.5}
                                                    onChange={(e) => {
                                                        updateCut(cut.id, {
                                                            properties: { ...cut.properties, grooveFraction: parseFloat(e.target.value) }
                                                        });
                                                    }}
                                                    className="w-full h-1 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                />
                                            </div>

                                            {/* 底形状 */}
                                            <div>
                                                <div className="text-[10px] text-zinc-500 mb-1">底形状</div>
                                                <div className="grid grid-cols-3 gap-1">
                                                    {([
                                                        { value: 'flat' as const, label: 'フラット', icon: '▬' },
                                                        { value: 'v' as const, label: 'V字', icon: 'V' },
                                                        { value: 'round' as const, label: '丸底', icon: 'U' },
                                                    ]).map(shape => (
                                                        <button
                                                            key={shape.value}
                                                            onClick={() => {
                                                                updateCut(cut.id, {
                                                                    properties: { ...cut.properties, bottomShape: shape.value }
                                                                });
                                                            }}
                                                            className={`py-1.5 rounded text-xs font-bold transition-all ${
                                                                (cut.properties.bottomShape ?? 'flat') === shape.value
                                                                    ? 'bg-indigo-600 text-white'
                                                                    : 'bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-400'
                                                            }`}
                                                        >
                                                            <span className="block text-base leading-none mb-0.5">{shape.icon}</span>
                                                            {shape.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ゾーン情報（読み取り専用） */}
                                    {!isVertical && (
                                        <div className="text-[10px] text-zinc-400 text-right pt-1">
                                            {cut.startZ.toFixed(1)}〜{cut.endZ.toFixed(1)}mm（全幅 {(cut.endZ - cut.startZ).toFixed(1)}mm）
                                        </div>
                                    )}
                                </div>
                            </div>
                            );
                        })}
                    </div>
                </div>

                <div className="pt-6 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                    <button
                        onClick={async () => {
                            const dxfInput = {
                                length, maxDiameter, cuts,
                                frontTaperLength, rearTaperLength,
                                holeDepthFront, holeDepthRear,
                                outline, frontEndShape, rearEndShape,
                                materialDensity,
                            };
                            const result = await shareDxf(dxfInput);
                            if (result.status === 'failed') {
                                // アップロード失敗 → ローカルダウンロードにフォールバック
                                exportToDxf(dxfInput);
                                alert(
                                    `アップロードに失敗しました: ${result.error}\n\n` +
                                    'DXF をダウンロードしました。LINE 公式アカウントに添付してください。',
                                );
                                return;
                            }
                            if (result.status === 'clipboard') {
                                const open = confirm(
                                    `DXFを30日間有効なURLとしてアップロードしました:\n${result.url}\n\n` +
                                    'クリップボードにコピー済みです。\n' +
                                    'これから公式LINEを開きます。チャットに貼り付けて送信してください。\n\n' +
                                    'OK で公式LINEを開きます。',
                                );
                                if (open) {
                                    window.open(OFFICIAL_LINE_URL, '_blank', 'noopener,noreferrer');
                                }
                            }
                            // auto-line / web-share の場合は何もせず終了 (LINE が開いている)
                        }}
                        className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg transition-opacity flex items-center justify-center gap-2"
                        data-testid="share-dxf-line"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                        </svg>
                        このバレルで相談する
                    </button>
                </div>
            </div>
        </div>
    );
};
