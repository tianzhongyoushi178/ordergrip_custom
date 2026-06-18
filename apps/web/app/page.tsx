'use client';

import { Scene } from '@/components/canvas/Scene';
import { Editor } from '@/components/features/Editor';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useBarrelStore } from '@/lib/store/useBarrelStore';

export default function Home() {
  // 「戻す」は上部のオーバーレイに常時表示する(エディタをスクロールしても消えない)。
  const undo = useBarrelStore((s) => s.undo);
  const canUndo = useBarrelStore((s) => s.past.length > 0);

  return (
    <main className="flex flex-col md:block relative w-full h-[100dvh] bg-zinc-950 overflow-hidden">
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

      {/* 上部右ツールバー: 戻す / 真横 / 視点リセット。
          flex で自動整列し固定オフセットの衝突を避ける。常時表示でエディタのスクロールに影響されない。 */}
      <div className="absolute top-4 right-4 md:right-[21rem] z-10 flex items-center gap-2">
        {/* Undo Button */}
        <button
          onClick={() => undo()}
          disabled={!canUndo}
          title="戻す"
          data-testid="undo-button"
          className="flex items-center gap-1.5 bg-white/90 dark:bg-zinc-900/90 text-zinc-600 dark:text-zinc-300 px-3 py-2 rounded-lg shadow-lg hover:bg-white dark:hover:bg-zinc-800 transition-all active:scale-95 border border-zinc-200 dark:border-zinc-800 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 14L4 9l5-5M4 9h11a4 4 0 014 4v3" /></svg>
          戻す
        </button>

        {/* 真横ビュー Button */}
        <button
          onClick={() => useBarrelStore.getState().triggerCameraSide()}
          title="真横から見る"
          data-testid="side-view-button"
          className="flex items-center gap-1.5 bg-white/90 dark:bg-zinc-900/90 text-zinc-600 dark:text-zinc-300 px-3 py-2 rounded-lg shadow-lg hover:bg-white dark:hover:bg-zinc-800 transition-all active:scale-95 border border-zinc-200 dark:border-zinc-800 text-xs font-bold"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h18" />
            <path d="M6 9l-3 3 3 3" />
            <path d="M18 9l3 3-3 3" />
          </svg>
          真横
        </button>

        {/* Reset Camera Button */}
        <button
          onClick={() => useBarrelStore.getState().triggerCameraReset()}
          className="bg-white/90 dark:bg-zinc-900/90 text-zinc-600 dark:text-zinc-300 p-2 rounded-lg shadow-lg hover:bg-white dark:hover:bg-zinc-800 transition-all active:scale-95 border border-zinc-200 dark:border-zinc-800"
          title="視点をリセット"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>

      {/* 3D Scene Layer */}
      {/* Mobile: Top 40% height. Desktop: Full screen background */}
      <div
        className="absolute top-0 left-0 w-full h-[40dvh] md:inset-0 md:h-full z-0 cursor-move border-b border-zinc-200 dark:border-zinc-800 md:border-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(8,8,12,0.78), rgba(8,8,12,0.78)), url('/justonegrip-bg.jpg')",
          backgroundSize: 'cover, contain',
          backgroundRepeat: 'no-repeat, no-repeat',
          backgroundPosition: 'center, center',
          backgroundColor: '#0a0a0a',
        }}
      >
        {/* 3D描画(WebGLコンテキスト生成失敗や外部アセット取得失敗)でアプリ全体が
            落ちないよう隔離。失敗してもエディタ・重量計算・DXF出力は使える。 */}
        <ErrorBoundary
          fallback={(reset) => (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-zinc-300">
              <p className="text-sm font-bold">3Dプレビューを読み込めませんでした</p>
              <p className="text-xs text-zinc-500 max-w-xs">
                通信環境や端末のグラフィック制限が原因の可能性があります。設定の編集や重量計算はそのまま利用できます。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={reset}
                  className="px-4 py-2 rounded-lg bg-white/90 text-zinc-800 text-xs font-bold hover:bg-white active:scale-95 transition-all"
                >
                  3Dを再試行
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 text-xs font-bold hover:bg-zinc-800 active:scale-95 transition-all"
                >
                  ページを再読み込み
                </button>
              </div>
            </div>
          )}
        >
          <Scene />
        </ErrorBoundary>
      </div>

      {/* 操作ガイド */}
      <div className="absolute bottom-2 left-4 md:bottom-4 md:left-6 z-10 pointer-events-none select-none hidden md:flex gap-3 text-[10px] text-zinc-400">
        <span>左ドラッグ: 回転</span>
        <span>右ドラッグ: 移動</span>
        <span>スクロール: ズーム</span>
      </div>
      <div className="absolute top-[38dvh] left-4 z-10 pointer-events-none select-none flex md:hidden gap-3 text-[10px] text-zinc-400">
        <span>1本指: 回転</span>
        <span>2本指: 移動&amp;ズーム</span>
      </div>

      {/* UI Overlay */}
      {/* Editor component handles its own sizing (h-50vh on mobile, absolute sidebar on desktop) */}
      <Editor />
    </main>
  );
}
