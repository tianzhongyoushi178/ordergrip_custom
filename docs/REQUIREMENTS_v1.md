# 要件定義書 v1: BARREL LAB. ダーツバレル3Dコンフィギュレーター

## 1. プロダクト概要

### 目的
Webブラウザ上でダーツバレルを3Dパラメトリックモデリングし、重量・重心をリアルタイム計算しながらカスタムデザインを作成・保存できるツール。

### ターゲットユーザー
- ダーツバレルの設計・カスタマイズに興味があるダーツプレイヤー
- バレルメーカーの設計担当者

### 解決する課題
- 実物を作らずにバレルの形状・重量・重心をシミュレーション可能にする
- PDF図面からの形状インポートによる既存バレルの再現

---

## 2. 機能要件

### FR-001: 3Dバレル描画
- 概要: パラメータに基づいてダーツバレルの3Dモデルをリアルタイムレンダリング
- 入力: BarrelState（全長、最大径、テーパー、カット、アウトライン、穴深さ）
- 処理:
  - 2Dプロファイル生成（generateProfile）：解像度0.1mm刻み
  - アウトライン補間 or テーパーロジックで基本形状決定
  - カットパターン適用（2Dプロファイル上で深さ減算）
  - フルジオメトリ構築（generateBarrelGeometry）：内穴→外面→内穴の断面回転体
  - ラジアルセグメント: 64分割
  - 穴壁解像度: 0.2mm
  - 穴半径: 2.1mm（2BAネジ規格）
  - 先端径: 5.8mm（tipRadius=2.9mm）
  - ネジ山シミュレーション: pitch=0.8mm, depth=0.15mm
- 出力: THREE.BufferGeometry → meshレンダリング
- 受入条件:
  - パラメータ変更時に3Dモデルが即時更新される
  - 内穴（前後）が正しく表現される
  - カットパターンがプロファイルに反映される
  - メタル調マテリアル（color=#D1D5DB, roughness=0.3, metalness=0.8, DoubleSide）
- 優先度: Must
- 実装状態: 実装済み

### FR-002: パラメトリック寸法変更
- 概要: スライダー/数値入力でバレル寸法をリアルタイム変更
- 入力: UIコントロール操作
- パラメータ:
  - 全長: 20〜150mm, step=0.5mm, デフォルト=45.0mm
  - 最大径: 5.5〜8.5mm, step=0.1mm, デフォルト=7.0mm
  - フロントテーパー長: 0〜全長mm, step=0.5mm, デフォルト=10mm
  - リアテーパー長: 0〜全長mm, step=0.5mm, デフォルト=10mm
  - 前穴深さ: 0〜30mm, step=0.5mm, デフォルト=10.0mm
  - 後穴深さ: 0〜30mm, step=0.5mm, デフォルト=15.0mm
- 処理: Zustand storeの状態更新 → useMemoによるジオメトリ再計算
- 出力: 3Dモデル・物理値の即時更新
- 受入条件:
  - スライダー操作で3Dモデルがスムーズに変形する
  - 数値直接入力も可能
  - 寸法変更時にshapeTypeが'custom'に自動変更される
- 優先度: Must
- 実装状態: 実装済み

### FR-003: 基本形状選択
- 概要: トルピード/ストレートの2種類のプリセット形状を選択
- 入力: ボタン選択
- 処理:
  - トルピード: frontTaperLength=15, rearTaperLength=15
  - ストレート: frontTaperLength=5, rearTaperLength=5
- 出力: テーパー長の自動設定
- 受入条件: 形状選択時にテーパー値が即座に更新される
- 優先度: Must
- 実装状態: 実装済み

### FR-004: カットパターン適用
- 概要: バレル表面にカットパターンを追加・編集・削除
- 入力: CutSelectorでタイプ選択 → パラメータ調整
- サポートカットタイプ（14種）:
  1. ring: 矩形溝（cutWidth調整可能）
  2. ring_double: 2本溝（cutWidth + gapWidth）
  3. ring_triple: 3本溝（cutWidth + gapWidth）
  4. ring_r / scallop: 正弦波溝（U字型）
  5. ring_v: V字溝
  6. shark: 鋸歯状（前方テーパー→後方急壁）
  7. wing: シャーク+フラット頂点（flatWidth調整可能）
  8. canyon: 台形溝（20%テーパー-60%フラット-20%テーパー）
  9. step: 階段状（40%深-30%中-30%浅）
  10. stair: 滑らかな階段（ランプ遷移付き）
  11. micro: ring同等（細ピッチ想定）
  12. vertical: 縦方向カット（3D的に処理、周方向分割）
  13. none: カットなし
- カット属性:
  - startZ / endZ: バレル先端からの位置(mm)
  - depth: 溝の深さ(mm) デフォルト=0.5, 範囲=0.1〜1.0
  - pitch: ピッチ(mm) デフォルト=1.0, 範囲=0.1〜5.0
  - itemCount: 縦カット数 デフォルト=12, 範囲=2〜48
  - cutWidth: 溝幅(mm) - ring系用
  - gapWidth: カット間隔(mm) - double/triple用
  - flatWidth: フラット頂点長(mm) - wing用
- 処理:
  - 追加時: バレル中央に10mm幅で配置、衝突時は空きスペースを2mm刻みで探索
  - 衝突チェック: verticalカット以外はオーバーラップ禁止
  - verticalカットは他カットと重複可能
  - 半径最小値: 0.5mm（クランプ）
- 出力: プロファイルへの深さ適用、3Dジオメトリ更新
- 受入条件:
  - カット追加でリアルタイムに3D反映
  - 開始位置・幅のスライダーで移動可能
  - タイプ別にUI表示制御（cutWidth/gapWidth/flatWidth/itemCountの条件付き表示）
  - 衝突時にスライダー操作がブロックされる
- 優先度: Must
- 実装状態: 実装済み

### FR-005: リアルタイム重量・重心計算
- 概要: バレルパラメータから重量(g)と重心位置(mm)をリアルタイム計算
- 入力: 2Dプロファイル点列 + 密度 + 穴深さ
- 処理:
  - 円錐台積分（V = πh/3 × (r1² + r1r2 + r2²)）
  - 重心: 各セグメントの体積モーメント積算
  - 穴体積減算（円柱近似、穴半径=0.21cm）
  - mm→cm単位変換
- 出力: volume(cm³), weight(g), centerOfGravity(mm from front)
- 受入条件:
  - パラメータ変更でリアルタイム更新
  - 重量は小数2桁、重心は小数1桁表示
  - 穴の体積・モーメントが正しく減算される
- 優先度: Must
- 実装状態: 実装済み

### FR-006: 素材（タングステン比率）選択
- 概要: タングステン合金の比率に応じた密度設定
- 入力: セレクトボックス選択
- プリセット:
  - タングステン95%: 18.0 g/cm³
  - タングステン90%: 17.0 g/cm³（デフォルト）
  - タングステン80%: 15.0 g/cm³
  - タングステン70%: 13.5 g/cm³
- SpecWizardでは70〜97%のスライダー入力、線形補間で密度計算（W*19.3 + (1-W)*8.9）
- 出力: materialDensity更新 → 重量再計算
- 優先度: Must
- 実装状態: 実装済み

### FR-007: データ永続化
- 概要: バレルデザインの保存・読込・エクスポート・インポート
- 機能:
  - LocalStorage保存: キー='dart-barrel-design'
  - LocalStorage読込: 保存データの復元
  - JSONエクスポート: ファイル名='my-barrel.json'、タイムスタンプ付き
  - JSONインポート: ファイル選択→データ反映
- 保存対象: length, maxDiameter, cuts, materialDensity, frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear
- 注意: outline, shapeTypeはLocalStorageに保存されていない（潜在的バグ）
- 優先度: Must
- 実装状態: 実装済み（outlineの保存漏れあり）

### FR-008: PDF図面インポート（OCR）
- 概要: PDF図面からテキスト/OCRでスペック値を抽出
- 入力: PDFファイル
- 処理:
  - pdfjs-distでテキスト抽出を試行
  - テキスト不足時はTesseract.jsでOCR（eng+jpn）
  - 正規表現で全長/最大径/重量を抽出
- 出力: ExtractedSpecs（length, maxDiameter, weight）
- 受入条件: 解析結果のプレビュー表示 → 「反映」ボタンで適用
- 優先度: Should
- 実装状態: 実装済み

### FR-009: AI図面解析（Gemini）
- 概要: Gemini 2.0 Flash APIで図面画像からバレル仕様を構造化抽出
- 入力: PDFファイル（1ページ目をJPEG変換）
- 認証: パスワード保護（パスワード='OG2031'、3回失敗でロック）
- APIキー: 環境変数 NEXT_PUBLIC_GEMINI_API_KEY or localStorage
- 処理: 詳細プロンプトでJSON形式の仕様抽出（outline点列、カット情報含む）
- 出力: ExtractedSpecs（length, maxDiameter, weight, frontTaperLength, rearTaperLength, rearTaperStartZ, outline, cuts）
- 受入条件:
  - ステータス表示（変換中→解析中→完了）
  - 結果プレビュー（全長、最大径、重量、カット検出数）
  - 反映時にoutline + cuts をsetAllで一括適用
- 優先度: Should
- 実装状態: 実装済み

### FR-010: スペック入力ウィザード
- 概要: 初回起動時の3ステップガイド
- ステップ:
  1. 寸法入力（全長、最大径）
  2. 形状選択（トルピード/ストレート）
  3. 素材選択（タングステン比率スライダー 70〜97%）
- 処理: 完了時にsetAllで一括適用（cuts=[], outline=[]にリセット）
- 表示制御: showWizard=true（初期表示）、「再ヒアリング」ボタンで再表示
- 優先度: Should
- 実装状態: 実装済み

### FR-011: 3Dシーン操作
- 概要: 3Dビューのカメラ制御と表示設定
- 機能:
  - OrbitControls: マウス/タッチでの回転・ズーム・パン
  - カメラリセット: ボタンクリックでデフォルト位置（40, 30, 60）に復帰
  - 前後ラベル: Billboard Textで「前 (チップ側)」「後 (シャフト側)」表示
  - 環境マップ: 'city'プリセット
  - 影: ContactShadows（resolution=1024, scale=20）
- レスポンシブ:
  - モバイル: フォントサイズ=2.5, ラベルY=8
  - デスクトップ: フォントサイズ=4, ラベルY=4
- 優先度: Must
- 実装状態: 実装済み

---

## 3. 非機能要件

### NFR-001: パフォーマンス
- 内容: スライダー操作時のフレームレートを維持
- 基準: Lighthouse Performance > 90、スマホ動作前提
- 実装: useMemoによるジオメトリキャッシュ
- 実装状態: 部分実装（Lighthouseテスト未実施）

### NFR-002: レスポンシブデザイン
- 内容: モバイル・デスクトップ両対応レイアウト
- 基準:
  - モバイル: 上部40vh=3D、下部60vh=エディタ（ボトムシート、角丸上部）
  - デスクトップ: 全画面3D + 右サイドバーw-80（320px）
  - ブレークポイント: md (768px)
- 実装状態: 実装済み

### NFR-003: WebGL最適化
- 内容: WebGL描画負荷の最適化
- 基準: スマホ（ローエンド含む）でのスムーズ動作
- 懸念: 0.1mm解像度のプロファイル + 64セグメント → 頂点数が多い可能性
- 実装状態: 基本実装済み（最適化余地あり）

### NFR-004: セキュリティ
- 内容: AI機能のアクセス制御
- 実装: パスワード保護（3回失敗ロック、LocalStorage管理）
- 懸念: パスワードがクライアントサイドにハードコード（'OG2031'）
- 実装状態: 実装済み（セキュリティレベルは低い）

---

## 4. データモデル

### BarrelState
```typescript
{
  length: number;           // mm, default=45.0
  maxDiameter: number;      // mm, default=7.0
  frontTaperLength: number; // mm, default=10
  rearTaperLength: number;  // mm, default=10
  shapeType: 'torpedo' | 'straight' | 'custom';
  outline: OutlinePoint[];  // カスタムアウトライン
  materialDensity: number;  // g/cm³, default=17.0
  holeDepthFront: number;   // mm, default=10.0
  holeDepthRear: number;    // mm, default=15.0
  cuts: CutZone[];
  cameraResetTrigger: number;
}
```

### CutZone
```typescript
{
  id: string;              // ランダム生成（Math.random().toString(36).substr(2,9)）
  type: CutType;
  startZ: number;          // mm from front
  endZ: number;            // mm from front
  properties: {
    pitch?: number;        // mm
    depth?: number;        // mm
    itemCount?: number;    // vertical用
    cutWidth?: number;     // mm, ring系用
    gapWidth?: number;     // mm, double/triple用
    flatWidth?: number;    // mm, wing用
  }
}
```

### PhysicsData
```typescript
{
  volume: number;          // cm³
  weight: number;          // g
  centerOfGravity: number; // mm from front
}
```

---

## 5. 画面構成

### メインレイアウト（page.tsx）
- ヘッダー: 「BARREL LAB.」ロゴ（左上、pointer-events-none）
- カメラリセットボタン: 右上
- 3Dビュー: 背景レイヤー（z-0）
- エディタ: オーバーレイ（z-20）

### エディタパネル（Editor.tsx）
上から順に:
1. ヘッダー（「バレルスペック設定」+ 再ヒアリングボタン）
2. PDF/AIインポート
3. スペック表示（重量・重心）
4. 素材選択
5. 基本形状選択
6. テーパー詳細設定（折りたたみ）
7. 穴深さ設定
8. 全長・最大径スライダー
9. カット追加（CutSelector）
10. カット一覧（各カットの詳細編集）
11. 保存/読込/エクスポート/インポートボタン

---

## 6. 技術制約

- ES modules使用（CommonJS不可）
- `any`型・`@ts-ignore`禁止
- 3DロジックとReact状態管理は明確に分離
- デプロイ: Vercel
- パッケージマネージャー: pnpm 9.15.0

---

## 7. 未実装/改善が必要な項目

### 7.1 データ保存の不整合
- LocalStorageにoutline, shapeTypeが保存されていない
- JSONエクスポートにもoutlineが含まれていない

### 7.2 ハードコード値
- tipRadius = 2.9mm (5.8mm径) → 設定不可
- threadRadius = 2.9mm → 同上
- holeRadius = 2.1mm (2BA規格) → 固定
- radialSegments = 64 → 固定（パフォーマンス調整不可）
- プロファイル解像度 = 0.1mm → 固定
- ネジ山パラメータ: pitch=0.8mm, depth=0.15mm → 固定
- カット追加時のデフォルト幅 = 10mm → 固定
- 衝突チェック探索ステップ = 2mm → 固定

### 7.3 セキュリティ
- パスワード('OG2031')がクライアントサイドにハードコード
- APIキーがNEXT_PUBLIC_（クライアント公開）

### 7.4 UI/UX
- layout.tsxのmetadataが未更新（"Create Next App"のまま）
- html lang="en"（日本語アプリなのにen）
- SpecWizardでカスタム形状選択肢なし
- Editor内のdropdown素材選択とWizardのスライダー選択で入力方法が異なる

### 7.5 計算精度
- 穴は円柱近似（実際はネジ山あり）→ 体積計算に微小誤差
- 2Dプロファイルベースの体積計算では縦カットの体積減算が反映されない

### 7.6 テスト
- ユニットテストが存在しない（docs/CLAUDE.mdでTDD推奨とあるが未実施）
