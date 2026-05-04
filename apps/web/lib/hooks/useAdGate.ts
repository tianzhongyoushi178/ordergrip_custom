'use client';

import { useEffect, useRef, useState } from 'react';
import { useBarrelStore } from '@/lib/store/useBarrelStore';

const COUNT_KEY = 'orderGrip_cutAddCount';
const AD_TRIGGER_INTERVAL = 3;

interface AdGate {
  showAd: boolean;
  dismissAd: () => void;
}

/**
 * カット追加回数を localStorage で記録し、3回ごとに広告フラグを立てる。
 * `cuts.length` が前回より増えたタイミングのみ追加扱いとする（削除や状態復元では加算しない）。
 */
export function useAdGate(): AdGate {
  const cutsLength = useBarrelStore((s) => s.cuts.length);
  const prevLengthRef = useRef(cutsLength);
  const [showAd, setShowAd] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const prev = prevLengthRef.current;
    prevLengthRef.current = cutsLength;

    if (cutsLength <= prev) return;

    const storedRaw = localStorage.getItem(COUNT_KEY);
    const stored = storedRaw ? parseInt(storedRaw, 10) : 0;
    const next = Number.isFinite(stored) && stored >= 0 ? stored + 1 : 1;

    localStorage.setItem(COUNT_KEY, String(next));

    if (next % AD_TRIGGER_INTERVAL === 0) {
      setShowAd(true);
    }
  }, [cutsLength]);

  return {
    showAd,
    dismissAd: () => setShowAd(false),
  };
}
