# Claude Code 実装指示（プロジェクト: Dart-3D-Configurator）

目的：
ユーザーがWebブラウザ上でダーツバレルを3Dモデリングし、スペック（重量・重心）を確認しながらカスタムデザインを保存できるツールを構築する。

スコープ（Mustのみ）：
- R3Fによる3Dバレル描画（シリンダー・円錐台の組み合わせ、またはカスタムGeometry生成）。
- UIスライダーによるパラメトリック変形（長さ、最大径）。
- カットパターンの適用（主要3種：リング、シャーク、ノーグルーブ）。
- LocalStorageによる簡易保存とJSONファイルへのエクスポート/インポート。
- リアルタイム重量計算ロジック。

非機能（抜粋）：
- WebGL描画負荷の最適化（スマホ動作前提）。
- UIはCanvasの上にオーバーレイし、操作を妨げない配置。

---

## 開発運用方針
- `docs/CLAUDE.md` をSSOT（信頼できる唯一の情報源）とし、設計変更時は必ずここを更新。
- 3DロジックとReactの状態管理（Zustand推奨）は明確に分離する。

## 推奨構成
apps/web/
├── app/                  # Next.js App Router
├── components/
│   ├── canvas/           # R3F 3D Components (Barrel, Scene, Lights)
│   ├── ui/               # Sliders, Buttons (Tailwind)
│   └── features/         # Editor logic
├── lib/
│   ├── store/            # Zustand (Design params state)
│   ├── math/             # Physics/Weight calculation logic
│   └── storage/          # Local persistence logic
docs/CLAUDE.md

## 手順
1. 「think harder」で3Dジオメトリ生成ロジック（LatheGeometry または CSG）の設計と、ZustandのStore設計を出力。
2. R3FのCanvasセットアップと、単純なシリンダー表示のプロトタイプ作成。
3. パラメータ（長さ・太さ）をGeometryに反映させるロジック実装（TDD推奨：数値入力→Mesh更新）。
4. 重量・重心計算ロジックの実装と単体テスト。
5. データ保存機能実装（LocalStorage + JSON Export）。
6. UIの磨き込み（Tailwind）とパフォーマンスチューニング。

## 品質ゲート
- 主要操作（スライダー操作→3D変化）のフレームレートが落ちないこと。
- Lighthouse Performance > 90。
- 重量計算ロジックのユニットテスト通過。

## 監視・運用初期設定
- Vercel Analytics (Core Web Vitals)

