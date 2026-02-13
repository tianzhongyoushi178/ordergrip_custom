import { useState } from 'react';
import { CutType } from '@/lib/store/useBarrelStore';

interface CutSelectorProps {
    onSelect: (type: CutType) => void;
}

type CategoryId = 'basic' | 'groove' | 'aggressive' | 'special';

interface CutDefinition {
    id: CutType;
    name: string;
    icon: React.ReactNode;
    category: CategoryId;
}

const CATEGORIES: { id: CategoryId; name: string }[] = [
    { id: 'basic', name: '基本' },
    { id: 'aggressive', name: '掛かり' },
    { id: 'groove', name: '形状' },
    { id: 'special', name: '特殊' },
];

const CUTS: CutDefinition[] = [
    // Basic
    {
        id: 'ring', name: 'リング', category: 'basic',
        icon: <path d="M4 4h16v16h-16z" stroke="currentColor" fill="none" strokeWidth={2} />
    },
    {
        id: 'ring_double', name: 'ダブル', category: 'basic',
        icon: <g stroke="currentColor" fill="none" strokeWidth={2}><path d="M4 4h4v16h-4z" /><path d="M12 4h4v16h-4z" /></g>
    },
    {
        id: 'ring_triple', name: 'トリプル', category: 'basic',
        icon: <g stroke="currentColor" fill="none" strokeWidth={2}><path d="M2 4h4v16h-4z" /><path d="M10 4h4v16h-4z" /><path d="M18 4h4v16h-4z" /></g>
    },
    // Aggressive
    {
        id: 'shark', name: 'シャーク', category: 'aggressive',
        icon: <path d="M4 4 L4 20 L20 20 Z" stroke="currentColor" fill="none" strokeWidth={2} />
    },
    {
        id: 'wing', name: 'ウィング', category: 'aggressive',
        icon: <path d="M4 20 L12 4 L20 20 Z" stroke="currentColor" fill="none" strokeWidth={2} />
    },
    {
        id: 'step', name: 'ステップ', category: 'aggressive',
        icon: <path d="M4 20 L4 12 L12 12 L12 4 L20 4" stroke="currentColor" fill="none" strokeWidth={2} />
    },
    {
        id: 'stair', name: 'ステア', category: 'aggressive',
        icon: <path d="M4 20 L10 14 L10 20 L16 14 L16 20" stroke="currentColor" fill="none" strokeWidth={2} />
    },
    // Groove
    {
        id: 'ring_r', name: 'Rリング', category: 'groove',
        icon: <path d="M4 4 Q12 20 20 4" stroke="currentColor" fill="none" strokeWidth={2} />
    },
    {
        id: 'ring_v', name: 'Vリング', category: 'groove',
        icon: <path d="M4 4 L12 20 L20 4" stroke="currentColor" fill="none" strokeWidth={2} />
    },
    {
        id: 'scallop', name: 'スカラップ', category: 'groove',
        icon: <path d="M2 12 Q12 2 22 12" stroke="currentColor" fill="none" strokeWidth={2} />
    },
    {
        id: 'canyon', name: 'キャニオン', category: 'groove',
        icon: <path d="M4 4 L8 20 L16 20 L20 4" stroke="currentColor" fill="none" strokeWidth={2} />
    },
    // Special
    {
        id: 'micro', name: 'マイクロ', category: 'special',
        icon: <path d="M2 4h2v16h-2z M6 4h2v16h-2z M10 4h2v16h-2z M14 4h2v16h-2z M18 4h2v16h-2z" stroke="currentColor" fill="none" strokeWidth={1} />
    },
    {
        id: 'vertical', name: '縦カット', category: 'special',
        icon: <path d="M12 2 L12 22 M8 2 L8 22 M16 2 L16 22" stroke="currentColor" fill="none" strokeWidth={2} transform="rotate(90 12 12)" />
    },
];

export const CutSelector = ({ onSelect }: CutSelectorProps) => {
    const [activeTab, setActiveTab] = useState<CategoryId>('basic');

    return (
        <div className="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-2 border border-zinc-200 dark:border-zinc-700">
            {/* Tabs */}
            <div className="flex gap-1 mb-2 overflow-x-auto pb-1 scrollbar-hide">
                {CATEGORIES.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => setActiveTab(cat.id)}
                        className={`
                            px-3 py-1.5 text-xs font-bold rounded-full whitespace-nowrap transition-all
                            ${activeTab === cat.id
                                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm'
                                : 'text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'}
                        `}
                    >
                        {cat.name}
                    </button>
                ))}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-4 gap-2 h-24 overflow-y-auto pr-1">
                {CUTS.filter(c => c.category === activeTab).map(cut => (
                    <button
                        key={cut.id}
                        onClick={() => onSelect(cut.id)}
                        className="flex flex-col items-center justify-center p-2 rounded-lg bg-white dark:bg-zinc-800 border-2 border-transparent hover:border-indigo-500 hover:shadow-md transition-all group"
                    >
                        <div className="w-8 h-8 mb-1 text-zinc-400 group-hover:text-indigo-500 transition-colors">
                            <svg viewBox="0 0 24 24" className="w-full h-full">
                                {cut.icon}
                            </svg>
                        </div>
                        <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-300">
                            {cut.name}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
};
