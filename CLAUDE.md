# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

ダーツバレルの3Dコンフィギュレーター。Webブラウザ上でバレルをパラメトリックにモデリングし、重量・重心をリアルタイム計算できるツール。

## 開発コマンド

```bash
# モノレポ全体（ルートディレクトリから）
pnpm dev              # 開発サーバー起動
pnpm build            # プロダクションビルド
pnpm lint             # ESLint実行

# Webアプリ単体（apps/web/から）
pnpm dev              # Next.js開発サーバー（localhost:3000）
pnpm build            # プロダクションビルド
pnpm lint             # ESLint
```

型チェック:
```bash
cd apps/web && npx tsc --noEmit
```

## 技術スタック

- **モノレポ**: pnpm workspaces + Turborepo
- **フレームワーク**: Next.js 16 (App Router)
- **3D描画**: React Three Fiber (R3F) + drei
- **状態管理**: Zustand
- **スタイリング**: Tailwind CSS v4

## アーキテクチャ

### ディレクトリ構成（apps/web/）

```
app/                  # Next.js App Router (page.tsx がエントリーポイント)
components/
  canvas/             # R3F 3Dコンポーネント
    Scene.tsx         # Canvas、カメラ、ライティング設定
    Barrel.tsx        # バレルメッシュのレンダリング
  features/           # UI/機能コンポーネント
    Editor.tsx        # メインエディタUI（スライダー等）
    CutSelector.tsx   # カットパターン選択UI
    PDFUploader.tsx   # PDF解析からバレル形状インポート
    SpecWizard.tsx    # スペック入力ウィザード
lib/
  store/              # Zustand Store
    useBarrelStore.ts # バレルパラメータのグローバル状態
  math/
    generator.ts      # 3Dジオメトリ生成（LatheGeometry相当）
    physics.ts        # 重量・重心計算
  storage/
    local.ts          # LocalStorage永続化
```

### データフロー

1. **状態**: `useBarrelStore` がバレルの全パラメータを管理（寸法、カット、アウトライン）
2. **ジオメトリ生成**: `generator.ts` がパラメータから THREE.BufferGeometry を生成
3. **物理計算**: `physics.ts` が断面積分で体積・重量・重心を計算
4. **描画**: `Barrel.tsx` がジオメトリをメッシュとしてレンダリング

### カットシステム

カットはゾーンベースで定義（`CutZone`型）:
- `startZ` / `endZ`: バレル先端からの位置 (mm)
- `type`: ring, shark, wing, canyon, vertical など
- `properties`: pitch, depth, itemCount

縦方向カット（vertical）は `generator.ts` 内で3D的に処理、他は2Dプロファイル段階で適用。

## 設計ドキュメント

詳細な要件・設計方針は `docs/CLAUDE.md` を参照。

## 注意事項

- ES modules使用（CommonJS不可）
- `any`型・`@ts-ignore`禁止
- WebGL描画負荷に注意（スマホ動作前提）
- 3DロジックとReact状態管理は明確に分離
