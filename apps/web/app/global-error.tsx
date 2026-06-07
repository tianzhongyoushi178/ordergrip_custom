'use client';

import { useEffect } from 'react';

/**
 * グローバルエラーバウンダリ (Next.js App Router 規約)。
 * ルートレイアウト(layout.tsx)自体のレンダーで例外が起きた場合のみ発火し、
 * layout を置き換えるため自前の <html>/<body> を持つ必要がある。
 * 通常のページ例外は app/error.tsx 側で処理される。
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Global render error:', error);
    }, [error]);

    return (
        <html lang="ja">
            <body
                style={{
                    minHeight: '100dvh',
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '16px',
                    background: '#09090b',
                    color: '#e4e4e7',
                    padding: '24px',
                    textAlign: 'center',
                    fontFamily: 'system-ui, sans-serif',
                }}
            >
                <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>問題が発生しました</h1>
                <p style={{ fontSize: '14px', color: '#a1a1aa', maxWidth: '24rem', margin: 0 }}>
                    画面の読み込み中にエラーが発生しました。お手数ですが再読み込みをお試しください。
                </p>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={reset}
                        style={{
                            padding: '10px 20px',
                            borderRadius: '8px',
                            border: 'none',
                            background: '#4f46e5',
                            color: '#fff',
                            fontSize: '14px',
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        再試行
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '10px 20px',
                            borderRadius: '8px',
                            border: '1px solid #3f3f46',
                            background: 'transparent',
                            color: '#d4d4d8',
                            fontSize: '14px',
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        再読み込み
                    </button>
                </div>
            </body>
        </html>
    );
}
