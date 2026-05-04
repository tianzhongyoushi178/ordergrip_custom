'use client';

import { Scene } from '@/components/canvas/Scene';
import { Editor } from '@/components/features/Editor';
import { AdModal } from '@/components/features/AdModal';
import { useBarrelStore } from '@/lib/store/useBarrelStore';
import { useAdGate } from '@/lib/hooks/useAdGate';

export default function Home() {
  const { showAd, dismissAd } = useAdGate();

  return (
    <main className="flex flex-col md:block relative w-full h-screen bg-zinc-950 overflow-hidden">
      <div className="absolute top-3 left-4 z-10 pointer-events-none select-none flex items-center gap-3 md:gap-4">
        <img src="/logo.png" alt="ORDER GRIP" className="h-12 md:h-14 w-auto" />
        <div className="h-10 md:h-12 w-px bg-zinc-700" />
        <img
          src="/justonegrip-bg.jpg"
          alt="Just one GRIP"
          className="h-14 md:h-16 w-auto"
          style={{ mixBlendMode: 'screen' }}
        />
      </div>

      {/* Reset Camera Button */}
      <button
        onClick={() => useBarrelStore.getState().triggerCameraReset()}
        className="absolute top-4 right-4 z-10 bg-white/90 dark:bg-zinc-900/90 text-zinc-600 dark:text-zinc-300 p-2 rounded-lg shadow-lg hover:bg-white dark:hover:bg-zinc-800 transition-all active:scale-95 border border-zinc-200 dark:border-zinc-800"
        title="視点をリセット"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>

      {/* 3D Scene Layer */}
      {/* Mobile: Top 40% height. Desktop: Full screen background */}
      <div
        className="absolute top-0 left-0 w-full h-[40vh] md:inset-0 md:h-full z-0 cursor-move border-b border-zinc-200 dark:border-zinc-800 md:border-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(8,8,12,0.78), rgba(8,8,12,0.78)), url('/justonegrip-bg.jpg')",
          backgroundSize: 'cover, contain',
          backgroundRepeat: 'no-repeat, no-repeat',
          backgroundPosition: 'center, center',
          backgroundColor: '#0a0a0a',
        }}
      >
        <Scene />
      </div>

      {/* 操作ガイド */}
      <div className="absolute bottom-2 left-4 md:bottom-4 md:left-6 z-10 pointer-events-none select-none hidden md:flex gap-3 text-[10px] text-zinc-400">
        <span>左ドラッグ: 回転</span>
        <span>右ドラッグ: 移動</span>
        <span>スクロール: ズーム</span>
      </div>
      <div className="absolute top-[38vh] left-4 z-10 pointer-events-none select-none flex md:hidden gap-3 text-[10px] text-zinc-400">
        <span>1本指: 回転</span>
        <span>2本指: 移動&amp;ズーム</span>
      </div>

      {/* UI Overlay */}
      {/* Editor component handles its own sizing (h-50vh on mobile, absolute sidebar on desktop) */}
      <Editor />

      {showAd && <AdModal onClose={dismissAd} />}
    </main>
  );
}
