'use client';

import { useState } from 'react';
import { useBarrelStore } from '@/lib/store/useBarrelStore';

interface SpecWizardProps {
    onComplete: () => void;
    onCancel: () => void;
}

export function SpecWizard({ onComplete, onCancel }: SpecWizardProps) {
    const [step, setStep] = useState(1);
    const setAll = useBarrelStore((state) => state.setAll);

    // Form State
    const [specs, setSpecs] = useState({
        length: 45.0,
        maxDiameter: 7.0,
        tungsten: 90,
        shapeType: 'torpedo' as 'torpedo' | 'straight',
        frontTaperLength: 15.0,
        rearTaperLength: 15.0,
    });

    const nextStep = () => setStep((s) => s + 1);
    const prevStep = () => setStep((s) => s - 1);

    const calculateDensity = (tungstenPct: number) => {
        // Basic linear interpolation between Nickel (8.9) and Tungsten (19.3)
        // 90% is typically around 17.0 - 18.0 in reality
        const w = tungstenPct / 100;
        return 19.3 * w + 8.9 * (1 - w);
    };

    const handleComplete = () => {
        setAll({
            shapeType: specs.shapeType,
            length: specs.length,
            maxDiameter: specs.maxDiameter,
            materialDensity: calculateDensity(specs.tungsten),
            frontTaperLength: specs.frontTaperLength,
            rearTaperLength: specs.rearTaperLength,
            cuts: [], // Reset cuts when starting fresh
            outline: [], // Reset custom outline
        });
        onComplete();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                {/* Header */}
                <div className="p-6 border-b border-zinc-800 bg-gradient-to-br from-indigo-500/10 to-purple-500/10">
                    <h2 className="text-xl font-bold text-white tracking-tight">バレルスペックの設定</h2>
                    <p className="text-sm text-zinc-400 mt-1">
                        ステップ {step} / 3: {step === 1 ? '基本サイズ' : step === 2 ? 'テーパー形状' : '材質設定'}
                    </p>
                    <div className="mt-4 h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-indigo-500 transition-all duration-500 ease-out"
                            style={{ width: `${(step / 3) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Content */}
                <div className="p-8 space-y-6">
                    {step === 1 && (
                        <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">全長 (mm)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={specs.length}
                                    onChange={(e) => setSpecs({ ...specs, length: Number(e.target.value) })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">最大径 (mm)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={specs.maxDiameter}
                                    onChange={(e) => setSpecs({ ...specs, maxDiameter: Number(e.target.value) })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                />
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                            <div className="grid grid-cols-1 gap-4">
                                <button
                                    onClick={() => setSpecs({ ...specs, shapeType: 'torpedo', frontTaperLength: 15, rearTaperLength: 15 })}
                                    className={`
                                        relative overflow-hidden p-4 rounded-2xl border-2 text-left transition-all duration-200
                                        ${specs.shapeType === 'torpedo'
                                            ? 'border-indigo-600 bg-indigo-500/10'
                                            : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}
                                    `}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className={`font-bold ${specs.shapeType === 'torpedo' ? 'text-indigo-400' : 'text-white'}`}>トルピード</h3>
                                        {specs.shapeType === 'torpedo' && (
                                            <div className="bg-indigo-600 rounded-full p-1">
                                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs text-zinc-400 leading-relaxed">
                                        重心が前寄り。緩やかな絞り込みのある、最もポピュラーな形状です。
                                    </p>
                                </button>

                                <button
                                    onClick={() => setSpecs({ ...specs, shapeType: 'straight', frontTaperLength: 5, rearTaperLength: 5 })}
                                    className={`
                                        relative overflow-hidden p-4 rounded-2xl border-2 text-left transition-all duration-200
                                        ${specs.shapeType === 'straight'
                                            ? 'border-indigo-600 bg-indigo-500/10'
                                            : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}
                                    `}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className={`font-bold ${specs.shapeType === 'straight' ? 'text-indigo-400' : 'text-white'}`}>ストレート</h3>
                                        {specs.shapeType === 'straight' && (
                                            <div className="bg-indigo-600 rounded-full p-1">
                                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs text-zinc-400 leading-relaxed">
                                        グリップ位置を選ばない。細身で直線的なアウトラインが特徴です。
                                    </p>
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">タングステン比率 (%)</label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="range"
                                        min="70"
                                        max="97"
                                        step="1"
                                        value={specs.tungsten}
                                        onChange={(e) => setSpecs({ ...specs, tungsten: Number(e.target.value) })}
                                        className="flex-1 accent-indigo-500 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer"
                                    />
                                    <span className="text-lg font-bold text-white w-12 text-right">{specs.tungsten}%</span>
                                </div>
                                <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
                                    比率が高いほど密度が増し、バレルを細く重く設計できます。
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 bg-zinc-950/50 border-t border-zinc-800 flex items-center justify-between gap-4">
                    <button
                        onClick={step === 1 ? onCancel : prevStep}
                        className="px-6 py-2.5 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                        {step === 1 ? 'キャンセル' : '戻る'}
                    </button>
                    <button
                        onClick={step === 3 ? handleComplete : nextStep}
                        className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                    >
                        {step === 3 ? 'モデリング開始' : '次へ'}
                    </button>
                </div>
            </div>
        </div>
    );
}
