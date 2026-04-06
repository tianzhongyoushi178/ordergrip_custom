import { useState } from 'react';
import { CutType } from '@/lib/store/useBarrelStore';

interface CutSelectorProps {
    onSelect: (type: CutType) => void;
}

type Rating = '強' | 'やや強' | '中(万能)' | 'やや弱' | '弱';
type SymbolRating = '◎' | '○' | '△';

interface CutMeta {
    id: CutType;
    name: string;
    strength: Rating;
    lifespan: SymbolRating;
    maintenance: SymbolRating;
    description: string;
    /** SVG <g> 要素の中身。barrelFrame と合成して描画する */
    groovePath: React.ReactNode;
}

const strengthColor = (s: Rating): string => {
    switch (s) {
        case '強': return 'text-red-500';
        case 'やや強': return 'text-orange-500';
        case '中(万能)': return 'text-blue-500';
        case 'やや弱': return 'text-teal-500';
        case '弱': return 'text-green-500';
    }
};

const ratingColor = (r: SymbolRating): string => {
    switch (r) {
        case '◎': return 'text-emerald-500';
        case '○': return 'text-blue-500';
        case '△': return 'text-amber-500';
    }
};

/** バレル外形フレーム（全カットアイコン共通） */
const BarrelFrame = () => (
    <rect x="2" y="4" width="20" height="16" rx="1" stroke="currentColor" fill="none" strokeWidth="1.2" opacity="0.3" />
);

/**
 * カットメタデータ定義
 *
 * 強さ・寿命・メンテナンス性は製品カタログ画像に基づく。
 * 特記: ring_triple は「やや弱」— ダーツバレルではトリプルリングは
 * 1溝あたりが浅く細くなるため、掛かりは弱く抜け重視の設計。
 * ring_double はピッチ内に2溝で掛かりが増すため「やや強」。
 */
const CUT_DATA: readonly CutMeta[] = [
    // --- リング系 ---
    {
        id: 'ring', name: 'リングカット',
        strength: '中(万能)', lifespan: '○', maintenance: '△',
        description: '溝幅、深さによってカット強さが変わる万能なカット。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1.2">
                <line x1="7" y1="4" x2="7" y2="20" />
                <line x1="12" y1="4" x2="12" y2="20" />
                <line x1="17" y1="4" x2="17" y2="20" />
            </g>
        ),
    },
    {
        id: 'ring_double', name: 'ダブルリングカット',
        strength: 'やや強', lifespan: '○', maintenance: '△',
        description: 'リングカットより掛かるように発展したカット。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1">
                <line x1="6" y1="4" x2="6" y2="20" />
                <line x1="8" y1="4" x2="8" y2="20" />
                <line x1="13" y1="4" x2="13" y2="20" />
                <line x1="15" y1="4" x2="15" y2="20" />
            </g>
        ),
    },
    {
        id: 'ring_triple', name: 'トリプルリングカット',
        // やや弱: 1ピッチに3溝を収めるため各溝が浅く細くなり、抜け重視の設計
        strength: 'やや弱', lifespan: '○', maintenance: '△',
        description: 'リングカットより抜けるように発展したカット。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="0.8">
                <line x1="5" y1="4" x2="5" y2="20" />
                <line x1="7" y1="4" x2="7" y2="20" />
                <line x1="9" y1="4" x2="9" y2="20" />
                <line x1="14" y1="4" x2="14" y2="20" />
                <line x1="16" y1="4" x2="16" y2="20" />
                <line x1="18" y1="4" x2="18" y2="20" />
            </g>
        ),
    },
    {
        id: 'ring_r', name: 'Rリングカット',
        strength: '中(万能)', lifespan: '○', maintenance: '◎',
        description: 'リングカットよりメンテナンス性のいいカット。リングカットよりやや抜けが良くなる。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1.2">
                <path d="M7 6 Q9 12 7 18" />
                <path d="M14 6 Q16 12 14 18" />
            </g>
        ),
    },
    {
        id: 'ring_v', name: 'Vリングカット',
        strength: '弱', lifespan: '◎', maintenance: '◎',
        description: '抜け感のいいカット。刺激が弱いカットが好みの方にオススメ！',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1.2">
                <path d="M6 5 L8 12 L6 19" />
                <path d="M13 5 L15 12 L13 19" />
            </g>
        ),
    },
    {
        id: 'canyon', name: 'キャニオンカット',
        strength: 'やや弱', lifespan: '○', maintenance: '○',
        description: 'リングカットとVリングカットの中間の掛かり具合。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1.2">
                <path d="M6 5 L7 8 L7 16 L6 19" />
                <path d="M14 5 L15 8 L15 16 L14 19" />
            </g>
        ),
    },
    // --- 攻撃的カット ---
    {
        id: 'step', name: 'ステップカット',
        strength: 'やや強', lifespan: '○', maintenance: '○',
        description: '抜け感と掛かりを両立しつつ、刺激が強めのカット。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1.2">
                <path d="M5 5 L5 10 L8 10 L8 19" />
                <path d="M13 5 L13 10 L16 10 L16 19" />
            </g>
        ),
    },
    {
        id: 'stair', name: 'ステアカット',
        strength: 'やや強', lifespan: '○', maintenance: '△',
        description: 'ステップカットよりやや滑らかな刺激。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1.2">
                <path d="M5 5 L6 10 L7 10 L8 19" />
                <path d="M13 5 L14 10 L15 10 L16 19" />
            </g>
        ),
    },
    {
        id: 'scallop', name: 'スキャロップカット',
        strength: 'やや強', lifespan: '△', maintenance: '○',
        description: '掛かりが強めで乾燥肌の方にオススメ。カットの寿命がやや短い。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1.2">
                <path d="M5 5 Q8 12 5 19" />
                <path d="M10 5 Q13 12 10 19" />
                <path d="M15 5 Q18 12 15 19" />
            </g>
        ),
    },
    {
        id: 'shark', name: 'シャークカット',
        strength: '強', lifespan: '△', maintenance: '△',
        description: '掛かりが強いカット。強いカットが好みな方にはおすすめ。肌が弱い方は注意が必要。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1.2">
                <path d="M5 5 L9 19 L5 19" />
                <path d="M13 5 L17 19 L13 19" />
            </g>
        ),
    },
    {
        id: 'wing', name: 'ウイングカット',
        strength: 'やや強', lifespan: '○', maintenance: '△',
        description: 'シャークカットよりマイルドな掛かり。カットの寿命もUP。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1.2">
                <path d="M5 5 Q7 14 9 19 L5 19" />
                <path d="M13 5 Q15 14 17 19 L13 19" />
            </g>
        ),
    },
    {
        id: 'micro', name: 'マイクロカット',
        strength: '弱', lifespan: '△', maintenance: '◎',
        description: '抜け感のいいカット。滑り止めの効果あり。',
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="0.6">
                {Array.from({ length: 10 }, (_, i) => (
                    <line key={i} x1={4 + i * 1.6} y1="5" x2={4 + i * 1.6} y2="19" />
                ))}
            </g>
        ),
    },
    // --- 特殊 ---
    {
        id: 'vertical', name: '縦カット',
        strength: '中(万能)', lifespan: '○', maintenance: '○',
        description: 'バレルの周方向に沿った縦溝カット。グリップ力の調整に使用。',
        // 縦カット = バレル軸方向の溝 → 縦線で表現
        groovePath: (
            <g stroke="currentColor" fill="none" strokeWidth="1">
                <line x1="6" y1="5" x2="6" y2="19" strokeDasharray="2 2" />
                <line x1="10" y1="5" x2="10" y2="19" strokeDasharray="2 2" />
                <line x1="14" y1="5" x2="14" y2="19" strokeDasharray="2 2" />
                <line x1="18" y1="5" x2="18" y2="19" strokeDasharray="2 2" />
            </g>
        ),
    },
];

/** カットアイコンの描画（フレーム＋溝パターンを合成） */
const CutIcon = ({ cut, className }: { cut: CutMeta; className?: string }) => (
    <svg viewBox="0 0 24 24" className={className}>
        <BarrelFrame />
        {cut.groovePath}
    </svg>
);

export const CutSelector = ({ onSelect }: CutSelectorProps) => {
    const [selectedId, setSelectedId] = useState<CutType | null>(null);
    const selectedCut = CUT_DATA.find(c => c.id === selectedId) ?? null;

    return (
        <div className="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
            {/* カットグリッド */}
            <div className="p-2">
                <div className="grid grid-cols-4 gap-1.5 max-h-44 overflow-y-auto pr-0.5" role="radiogroup" aria-label="カットタイプ選択">
                    {CUT_DATA.map(cut => (
                        <button
                            key={cut.id}
                            onClick={() => setSelectedId(selectedId === cut.id ? null : cut.id)}
                            aria-pressed={selectedId === cut.id}
                            className={`
                                flex flex-col items-center justify-center p-1.5 rounded-lg transition-all group
                                ${selectedId === cut.id
                                    ? 'bg-indigo-50 dark:bg-indigo-900/30 border-2 border-indigo-500 shadow-sm'
                                    : 'bg-white dark:bg-zinc-800 border-2 border-transparent hover:border-zinc-300 dark:hover:border-zinc-600'}
                            `}
                        >
                            <CutIcon
                                cut={cut}
                                className={`w-7 h-7 mb-0.5 transition-colors ${selectedId === cut.id ? 'text-indigo-500' : 'text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300'}`}
                            />
                            <span className={`text-[10px] font-bold leading-tight text-center ${selectedId === cut.id ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500 dark:text-zinc-400'}`}>
                                {cut.name.replace('カット', '')}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* 詳細パネル（選択時のみ表示。カット追加前にスペックを確認できる） */}
            {selectedCut && (
                <div className="border-t border-zinc-200 dark:border-zinc-700 p-3 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="flex items-start justify-between mb-2">
                        <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                            {selectedCut.name}
                        </h3>
                        <button
                            onClick={() => {
                                onSelect(selectedCut.id);
                                setSelectedId(null);
                            }}
                            className="px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded-md hover:bg-indigo-700 transition-colors shrink-0 ml-2"
                        >
                            追加
                        </button>
                    </div>

                    {/* スペック */}
                    <div className="grid grid-cols-3 gap-2 mb-2">
                        <div className="bg-white dark:bg-zinc-900 rounded-md px-2 py-1.5 text-center">
                            <div className="text-[10px] text-zinc-400 mb-0.5">カット強さ</div>
                            <div className={`text-[10px] font-bold ${strengthColor(selectedCut.strength)}`}>
                                {selectedCut.strength}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-zinc-900 rounded-md px-2 py-1.5 text-center">
                            <div className="text-[10px] text-zinc-400 mb-0.5">寿命</div>
                            <div className={`text-sm font-bold ${ratingColor(selectedCut.lifespan)}`}>
                                {selectedCut.lifespan}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-zinc-900 rounded-md px-2 py-1.5 text-center">
                            <div className="text-[10px] text-zinc-400 mb-0.5">メンテ</div>
                            <div className={`text-sm font-bold ${ratingColor(selectedCut.maintenance)}`}>
                                {selectedCut.maintenance}
                            </div>
                        </div>
                    </div>

                    {/* 説明文 */}
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        {selectedCut.description}
                    </p>
                </div>
            )}
        </div>
    );
};
