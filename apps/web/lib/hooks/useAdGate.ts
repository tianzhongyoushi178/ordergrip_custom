'use client';

import { useEffect, useState } from 'react';

const COUNT_KEY = 'orderGrip_useCount';
const SESSION_KEY = 'orderGrip_sessionCounted';
const AD_TRIGGER_INTERVAL = 3;

interface AdGate {
  showAd: boolean;
  dismissAd: () => void;
}

/**
 * アプリの起動回数を localStorage で記録し、3回ごとに広告フラグを立てる。
 * sessionStorage で同一セッション内の重複カウント（StrictMode の二重実行含む）を防ぐ。
 */
export function useAdGate(): AdGate {
  const [showAd, setShowAd] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (sessionStorage.getItem(SESSION_KEY)) return;

    const prevRaw = localStorage.getItem(COUNT_KEY);
    const prev = prevRaw ? parseInt(prevRaw, 10) : 0;
    const next = Number.isFinite(prev) && prev >= 0 ? prev + 1 : 1;

    localStorage.setItem(COUNT_KEY, String(next));
    sessionStorage.setItem(SESSION_KEY, '1');

    if (next % AD_TRIGGER_INTERVAL === 0) {
      setShowAd(true);
    }
  }, []);

  return {
    showAd,
    dismissAd: () => setShowAd(false),
  };
}
