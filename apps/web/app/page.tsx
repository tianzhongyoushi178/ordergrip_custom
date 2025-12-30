import { Scene } from '@/components/canvas/Scene';
import { Editor } from '@/components/features/Editor';

export default function Home() {
  return (
    <main className="flex flex-col md:block relative w-full h-screen bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      <div className="absolute top-4 left-6 z-10 pointer-events-none select-none">
        <h1 className="text-xl font-black tracking-tighter text-zinc-900 dark:text-zinc-50">
          BARREL <span className="text-blue-600">LAB.</span>
        </h1>
        <p className="text-xs font-medium text-zinc-400">ブラウザで創る、理想のバレル</p>
      </div>

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
