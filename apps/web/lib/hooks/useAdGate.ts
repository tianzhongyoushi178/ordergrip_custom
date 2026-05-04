'use client';

import { useEffect, useState } from 'react';
import { useBarrelStore, type BarrelState } from '@/lib/store/useBarrelStore';

const COUNT_KEY = 'orderGrip_changeCount';
const AD_TRIGGER_INTERVAL = 10;
const DEBOUNCE_MS = 300;

interface AdGate {
  showAd: boolean;
  dismissAd: () => void;
}

/**
 * 計数対象のフィールドだけをまとめたシグネチャ。
 * activeCutId / cameraResetTrigger などのUI専用フィールドは除外。
 */
function makeSignature(s: BarrelState): string {
  return JSON.stringify({
    length: s.length,
    maxDiameter: s.maxDiameter,
    materialDensity: s.materialDensity,
    frontTaperLength: s.frontTaperLength,
    rearTaperLength: s.rearTaperLength,
    holeDepthFront: s.holeDepthFront,
    holeDepthRear: s.holeDepthRear,
    shapeType: s.shapeType,
    frontEndShape: s.frontEndShape,
    rearEndShape: s.rearEndShape,
    cuts: s.cuts,
    outline: s.outline,
  });
}

/**
 * バレルパラメータ(寸法・素材・カット等)の変更回数を localStorage で記録し、10回ごとに広告フラグを立てる。
 * スライダー連続ドラッグなどの高頻度更新は 300ms の静止期間でひとまとめにカウントする。
 */
export function useAdGate(): AdGate {
  const [showAd, setShowAd] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let prevSig = makeSignature(useBarrelStore.getState());
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const commitChange = () => {
      pendingTimer = null;
      const storedRaw = localStorage.getItem(COUNT_KEY);
      const stored = storedRaw ? parseInt(storedRaw, 10) : 0;
      const next = Number.isFinite(stored) && stored >= 0 ? stored + 1 : 1;
      localStorage.setItem(COUNT_KEY, String(next));
      if (next % AD_TRIGGER_INTERVAL === 0) {
        setShowAd(true);
      }
    };

    const unsubscribe = useBarrelStore.subscribe((state) => {
      const sig = makeSignature(state);
      if (sig === prevSig) return;
      prevSig = sig;

      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(commitChange, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, []);

  return {
    showAd,
    dismissAd: () => setShowAd(false),
  };
}
