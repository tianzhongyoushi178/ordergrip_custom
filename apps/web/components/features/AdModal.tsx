'use client';

import { useEffect, useState } from 'react';

interface AdModalProps {
  onClose: () => void;
}

const COUNTDOWN_SECONDS = 20;
const AD_URL = 'https://order-grip.com/lp/';

const CIRCLE_RADIUS = 18;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

export function AdModal({ onClose }: AdModalProps) {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const closable = remaining <= 0;
  const elapsed = COUNTDOWN_SECONDS - remaining;
  const progressRatio = elapsed / COUNTDOWN_SECONDS;
  const dashOffset = CIRCLE_CIRCUMFERENCE * (1 - progressRatio);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="広告"
      data-testid="ad-modal"
    >
      <div
        className="min-h-full flex items-center justify-center p-3 sm:p-6"
        style={{
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[calc(100svh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] sm:max-h-[92vh] flex flex-col overflow-hidden">
        {/* Linear progress bar */}
        <div className="h-1 w-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all duration-1000 ease-linear"
            style={{ width: `${progressRatio * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-wider uppercase text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
              広告 / Sponsored
            </span>
          </div>

          {closable ? (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
              aria-label="広告を閉じる"
            >
              <span>閉じる</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              {/* Circular countdown */}
              <div className="relative w-11 h-11 flex-shrink-0" aria-live="polite" aria-atomic="true">
                <svg className="w-11 h-11 -rotate-90" viewBox="0 0 44 44">
                  <circle
                    cx="22"
                    cy="22"
                    r={CIRCLE_RADIUS}
                    stroke="currentColor"
                    strokeWidth="3"
                    fill="none"
                    className="text-zinc-200 dark:text-zinc-700"
                  />
                  <circle
                    cx="22"
                    cy="22"
                    r={CIRCLE_RADIUS}
                    stroke="currentColor"
                    strokeWidth="3"
                    fill="none"
                    strokeDasharray={CIRCLE_CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                    className="text-blue-600 transition-all duration-1000 ease-linear"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-blue-600 tabular-nums">
                  {remaining}
                </div>
              </div>

              <div className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 leading-tight">
                <div className="font-bold text-zinc-900 dark:text-zinc-100">
                  あと <span className="text-blue-600 tabular-nums text-base">{remaining}</span> 秒
                </div>
                <div className="text-[10px] sm:text-xs text-zinc-500">で閉じられます</div>
              </div>
            </div>
          )}
        </div>

        {/* Iframe content */}
        <div className="flex-1 relative bg-zinc-50 dark:bg-zinc-950 min-h-[240px] sm:min-h-[50vh]">
          <iframe
            src={AD_URL}
            className="absolute inset-0 w-full h-full border-0"
            title="ORDER GRIP - オーダーメイドダーツバレル"
            loading="eager"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>

        {/* Footer fallback link */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-center">
          <a
            href={AD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs sm:text-sm text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
          >
            別タブで詳細を見る
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </a>
        </div>
        </div>
      </div>
    </div>
  );
}
