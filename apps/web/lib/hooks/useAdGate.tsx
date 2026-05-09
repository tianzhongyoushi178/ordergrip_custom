'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface AdGate {
  showAd: boolean;
  dismissAd: () => void;
  triggerAd: (onAfter?: () => void | Promise<void>) => void;
}

const AdGateContext = createContext<AdGate | null>(null);

interface AdGateProviderProps {
  children: ReactNode;
}

/**
 * 広告モーダルの表示制御プロバイダ。手動トリガー専用 (自動表示は行わない)。
 * `triggerAd(onAfter)` を呼ぶと AdModal が表示され、ユーザーが閉じると `onAfter` を実行する。
 */
export function AdGateProvider({ children }: AdGateProviderProps) {
  const [showAd, setShowAd] = useState(false);
  const [pendingAfter, setPendingAfter] = useState<(() => void | Promise<void>) | null>(null);

  const triggerAd = useCallback((onAfter?: () => void | Promise<void>) => {
    setPendingAfter(() => onAfter ?? null);
    setShowAd(true);
  }, []);

  const dismissAd = useCallback(() => {
    setShowAd(false);
    if (pendingAfter) {
      void Promise.resolve(pendingAfter()).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Ad onAfter callback failed', err);
      });
      setPendingAfter(null);
    }
  }, [pendingAfter]);

  return (
    <AdGateContext.Provider value={{ showAd, dismissAd, triggerAd }}>
      {children}
    </AdGateContext.Provider>
  );
}

export function useAdGate(): AdGate {
  const ctx = useContext(AdGateContext);
  if (!ctx) {
    // Allow useAdGate to be called outside provider safely (e.g., in tests).
    return {
      showAd: false,
      dismissAd: () => {},
      triggerAd: () => {},
    };
  }
  return ctx;
}
