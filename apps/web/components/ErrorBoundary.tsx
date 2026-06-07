'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    /**
     * エラー時に描画する内容。関数を渡すと reset(再試行) を受け取れる。
     * R3F(Canvas)内で使う場合は DOM を返せないため null か 3D 要素を返すこと。
     */
    fallback?: ReactNode | ((reset: () => void) => ReactNode);
    /** エラー捕捉時の副作用(ログ送信など)。描画には影響しない。 */
    onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

/**
 * 汎用エラーバウンダリ。子ツリーのレンダー例外を捕捉し、アプリ全体のクラッシュを防ぐ。
 *
 * 用途:
 *  - 3Dシーン(WebGLコンテキスト生成失敗、drei Environment のHDR/troikaフォントの
 *    外部CDN取得失敗など)を隔離し、失敗してもUIの他部分を生かす。
 *  - React の error boundary は class コンポーネントでのみ実装可能なため class で定義。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        this.props.onError?.(error, info);
    }

    private reset = (): void => {
        this.setState({ hasError: false });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            const { fallback } = this.props;
            if (typeof fallback === 'function') return fallback(this.reset);
            return fallback ?? null;
        }
        return this.props.children;
    }
}
