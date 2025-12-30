'use client';

import { useState, useEffect } from 'react';
import { useBarrelStore } from '@/lib/store/useBarrelStore';

interface SpecWizardProps {
    onComplete: () => void;
    onCancel: () => void;
}

export function SpecWizard({ onComplete, onCancel }: SpecWizardProps) {
    const [step, setStep] = useState(1);
    const [hasMounted, setHasMounted] = useState(false);
    const setAll = useBarrelStore((state) => state.setAll);

    useEffect(() => {
        setHasMounted(true);
        // Prevent scrolling on mount
        document.body.style.overflow = 'hidden';

        return () => {
            // Restore scrolling on unmount
            document.body.style.overflow = '';
        };
    }, []);

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

    const updateShapeType = (type: 'torpedo' | 'straight') => {
        setSpecs(prev => ({
            ...prev,
            shapeType: type,
            frontTaperLength: type === 'torpedo' ? 15 : 5,
            rearTaperLength: type === 'torpedo' ? 15 : 5
        }));
    };

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

    if (!hasMounted) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 sm:items-center">
            <div className="w-full max-w-[340px] sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[520px] sm:max-h-[90vh] animate-in fade-in zoom-in duration-300">
                {/* Header - Very Slim for Mobile */}
                <div className="p-3 sm:p-5 border-b border-zinc-800 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 shrink-0 text-center">
                    <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">バレルスペック</h2>
                </div>

                {/* Progress Bar (Visible on Mobile) */}
                <div className="px-4 py-2 flex justify-center gap-3 bg-zinc-950/30 border-b border-zinc-800 shrink-0">
                    {[1, 2, 3].map((s) => (
                        <div key={s} className="flex items-center gap-1.5">
                            <div className={`w-3 h-3 rounded-full ${step >= s ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-zinc-800'}`} />
                        </div>
                    ))}
                </div>

                {/* Content */}
                <div className="p-4 sm:p-8 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                    {step === 1 && (
                        <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase">全長 (mm)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={specs.length}
                                    onChange={(e) => setSpecs({ ...specs, length: Number(e.target.value) })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 px-3 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase">最大径 (mm)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={specs.maxDiameter}
                                    onChange={(e) => setSpecs({ ...specs, maxDiameter: Number(e.target.value) })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2.5 px-3 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                                />
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-3 animate-in slide-in-from-right-4 duration-300">
                            <button
                                onClick={() => updateShapeType('torpedo')}
                                className={`w-full p-2.5 text-left border rounded-xl transition-all flex items-center gap-3 ${specs.shapeType === 'torpedo' ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'}`}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${specs.shapeType === 'torpedo' ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.86 6.02a2 2 0 0 0 0 3.66l8.31 3.84a2 2 0 0 0 1.66 0l8.31-3.84a2 2 0 0 0 0-3.66Z" /><path d="m19 12.16 3.11 1.43a2 2 0 0 1 0 3.66l-8.31 3.84a2 2 0 0 1-1.66 0l-8.31-3.84a2 2 0 0 1 0-3.66L7 12.16" /><path d="m5 16.53 7.17 3.32a2 2 0 0 0 1.66 0L21 16.53" /></svg>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-sm font-bold text-white leading-none">トルピード</h3>
                                    <p className="text-[10px] text-zinc-500 mt-1 truncate">扱いやすい人気の形状</p>
                                </div>
                            </button>
                            <button
                                onClick={() => updateShapeType('straight')}
                                className={`w-full p-2.5 text-left border rounded-xl transition-all flex items-center gap-3 ${specs.shapeType === 'straight' ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'}`}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${specs.shapeType === 'straight' ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /></svg>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-sm font-bold text-white leading-none">ストレート</h3>
                                    <p className="text-[10px] text-zinc-500 mt-1 truncate">安定感のある万能形状</p>
                                </div>
                            </button>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase">タングステン (%)</label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="range"
                                        min="70"
                                        max="97"
                                        step="1"
                                        value={specs.tungsten}
                                        onChange={(e) => setSpecs({ ...specs, tungsten: Number(e.target.value) })}
                                        className="flex-1 accent-indigo-500 h-1 bg-zinc-800 rounded-full appearance-none"
                                    />
                                    <span className="text-base font-black text-white w-10 text-right">{specs.tungsten}</span>
                                </div>
                                <p className="text-[10px] text-zinc-500 leading-tight">
                                    比率が高いほど、細くて重いバレルになります。
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-3 sm:p-5 bg-zinc-950/50 border-t border-zinc-800 flex items-center justify-between gap-3 shrink-0">
                    <button
                        onClick={step === 1 ? onCancel : prevStep}
                        className="flex-1 py-2.5 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors border border-zinc-800"
                    >
                        {step === 1 ? '閉じる' : '戻る'}
                    </button>
                    <button
                        onClick={step === 3 ? handleComplete : nextStep}
                        className="flex-[2] py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-black shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
                    >
                        {step === 3 ? '開始' : '次へ'}
                    </button>
                </div>
            </div>
        </div>
    );
}
