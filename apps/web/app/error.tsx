'use client';

import { useEffect } from 'react';

/**
 * ルートセグメントのエラーバウンダリ (Next.js App Router 規約)。
 * レンダー中の未捕捉例外をここで受け、英語の汎用クラッシュ画面ではなく
 * 日本語の復帰可能な画面を出す。reset() で再レンダーを試みる。
 */
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // 本番の最小ログ (Vercel のコンソールに残す)。digest でサーバー側ログと突合可能。
        console.error('App render error:', error);
    }, [error]);

    return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-200 p-6 text-center">
            <h1 className="text-lg font-bold">問題が発生しました</h1>
            <p className="text-sm text-zinc-400 max-w-sm">
                画面の読み込み中にエラーが発生しました。お手数ですが再読み込みをお試しください。
                繰り返す場合は、通信環境やブラウザを変えてお試しください。
            </p>
            <div className="flex gap-3">
                <button
                    onClick={reset}
                    className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold active:scale-95 transition-all"
                >
                    再試行
                </button>
                <button
                    onClick={() => window.location.reload()}
                    className="px-5 py-2.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-sm font-bold active:scale-95 transition-all"
                >
                    再読み込み
                </button>
            </div>
        </div>
    );
}
