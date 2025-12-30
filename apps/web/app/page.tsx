import { Scene } from '@/components/canvas/Scene';
import { Editor } from '@/components/features/Editor';
import { useBarrelStore } from '@/lib/store/useBarrelStore';

export default function Home() {
  return (
    <main className="flex flex-col md:block relative w-full h-screen bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      <div className="absolute top-4 left-6 z-10 pointer-events-none select-none">
        <h1 className="text-xl font-black tracking-tighter text-zinc-900 dark:text-zinc-50">
          BARREL <span className="text-blue-600">LAB.</span>
        </h1>
        <p className="text-xs font-medium text-zinc-400">ブラウザで創る、理想のバレル</p>
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
      {/* Mobile: Full screen background. Desktop: Full screen background */}
      <div className="absolute inset-0 z-0 cursor-move border-b border-zinc-200 dark:border-zinc-800 md:border-none">
        <Scene />
      </div>

      {/* UI Overlay */}
      {/* Editor component handles its own sizing (h-50vh on mobile, absolute sidebar on desktop) */}
      <Editor />
    </main>
  );
}
