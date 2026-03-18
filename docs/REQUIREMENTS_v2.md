# 要件定義書 v2: BARREL LAB. ダーツバレル3Dコンフィギュレーター

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

#### FR-001-1: 2Dプロファイル生成（generateProfile）
- 入力: length, maxDiameter, cuts[], frontTaperLen, rearTaperLen, outline[]
- 処理:
  1. z=0からz=lengthまで0.1mm刻みでループ
  2. 各zにおける半径rを決定:
     - **アウトラインモード**（outline.length > 1の場合）:
       - outlineをz昇順ソート
       - z ≤ outline[0].z → r = outline[0].d / 2
       - z ≥ outline[last].z → r = outline[last].d / 2
       - それ以外 → 隣接2点間の線形補間: r = (p1.d + (p2.d - p1.d) * ratio) / 2
     - **テーパーモード**（outline未使用時）:
       - z < frontTaperLen → r = tipRadius + (baseRadius - tipRadius) * (z / frontTaperLen)
       - z > length - rearTaperLen → r = threadRadius + (baseRadius - threadRadius) * ((length - z) / rearTaperLen)
       - それ以外 → r = baseRadius (= maxDiameter / 2)
  3. カット適用（FR-001-2参照）
  4. r < 0.5 の場合 r = 0.5 にクランプ
  5. Vector2(r, z)として点列に追加
  6. z === length でループ終了
- 定数:
  - tipRadius = 2.9 (先端径5.8mm)
  - threadRadius = 2.9 (ネジ端径5.8mm)
  - resolution = 0.1mm
- 出力: THREE.Vector2[] (r, z)の点列

#### FR-001-2: カット波形計算（2Dプロファイル上）
各カットゾーンにおいて、z位置でのcut.startZ ≤ z ≤ cut.endZの場合に半径を減算する。

localZ = z - cut.startZ
cycle = localZ % pitch
factor = cycle / pitch  （0.0〜1.0の正規化位置）

| カットタイプ | 波形計算式 | パラメータ |
|-------------|-----------|-----------|
| ring / micro | factor < (cutWidth ?? pitch*0.5) / pitch → r -= depth | cutWidth |
| ring_double | factor < cwD/pitch OR (factor >= (cwD+gwD)/pitch AND factor < (2*cwD+gwD)/pitch) → r -= depth | cutWidth(default=pitch*0.2), gapWidth(default=pitch*0.15) |
| ring_triple | 3区間判定: [0, cw), [cw+gw, 2cw+gw), [2cw+2gw, 3cw+2gw) → r -= depth | cutWidth(default=pitch*0.15), gapWidth(default=pitch*0.1) |
| shark | r -= depth * (1 - factor) | - |
| wing | taperR = 1 - flatWidth/pitch; factor < taperR → r -= depth * (1 - factor/taperR); else → no cut | flatWidth(default=pitch*0.3, max=pitch*0.9) |
| ring_v | factor < 0.5 → r -= depth * (factor/0.5); factor >= 0.5 → r -= depth * ((1-factor)/0.5) | - |
| ring_r / scallop | r -= depth * sin(factor * π) | - |
| canyon | factor < 0.2 → r -= depth * (factor/0.2); 0.2 ≤ factor < 0.8 → r -= depth; factor ≥ 0.8 → r -= depth * ((1-factor)/0.2) | - |
| step | factor < 0.4 → r -= depth; 0.4 ≤ factor < 0.7 → r -= depth * 0.5; else → 0 | - |
| stair | factor < 0.2 → r -= depth * 0.5 * (factor/0.2); 0.2 ≤ factor < 0.5 → r -= depth * 0.5; 0.5 ≤ factor < 0.7 → r -= depth * (0.5 + 0.5 * ((factor-0.5)/0.2)); else → r -= depth | - |
| vertical | 2Dプロファイルではスキップ（3Dで処理） | - |

#### FR-001-3: 3Dジオメトリ構築（generateBarrelGeometry）
- 入力: length, maxDiameter, cuts[], frontTaperLen, rearTaperLen, holeDepthFront, holeDepthRear, outline[]
- 定数: holeRadius = 2.1mm, radialSegments = 64, holeWallRes = 0.2mm
- 処理:
  1. **外面プロファイル取得**: generateProfile()呼出
  2. **フルプロファイル構築**（断面回転体の断面パス）:
     a. 前穴底: (0.001, holeDepthFront) ← 中心軸近く
     b. 前穴壁: (holeRadius, h) を h=holeDepthFront→0 まで0.2mm刻み
     c. 外面: outerPointsをそのまま追加
     d. 後穴壁: (holeRadius, z) を z=length→length-holeDepthRear まで0.2mm刻み
     e. 後穴底: (0.001, length - holeDepthRear)
  3. **頂点生成**: 各プロファイル点×(radialSegments+1)
     - theta = (j / radialSegments) * 2π
     - 面種判定: |rBase - holeRadius| < 0.01 → 内穴面, rBase > 2.5 → 外面
     - **外面の場合**: verticalカット適用
       - segmentRad = 2π / itemCount
       - localTheta = (theta % segmentRad) / segmentRad
       - wave = 1 - 2 * |localTheta - 0.5|
       - rMod = max(rMod, depth * wave)
     - **内穴面の場合**: ネジ山シミュレーション
       - rMod = 0.15 * sin(y * 2π / 0.8)
     - rFinal = max(0.1, rBase - rMod)
     - 頂点座標: (rFinal*sin(theta), -y, rFinal*cos(theta))
     - UV: (j/radialSegments, 1 - i/heightSegments)
  4. **インデックス生成**: 各セグメントで2三角形(CCW)
     - a = i*(segs+1)+j, b = a+1, c = (i+1)*(segs+1)+j, d = c+1
     - 三角形1: (a, d, b), 三角形2: (a, c, d)
  5. **後処理**: computeVertexNormals()
- 出力: THREE.BufferGeometry

#### FR-001-4: メッシュレンダリング（Barrel.tsx）
- ジオメトリをuseMemoでキャッシュ（依存: length, maxDiameter, cuts, frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear, outline）
- 後処理: rotateX(-π/2), translate(0, 0, -length/2)
- マテリアル: meshStandardMaterial
  - color: #D1D5DB
  - roughness: 0.3
  - metalness: 0.8
  - side: THREE.DoubleSide

### FR-002: パラメトリック寸法変更

| パラメータ | 最小 | 最大 | ステップ | デフォルト | UIタイプ |
|-----------|------|------|---------|-----------|---------|
| length | 20 | 150 | 0.5 | 45.0 | スライダー + 数値入力 |
| maxDiameter | 5.5 | 8.5 | 0.1 | 7.0 | スライダー + 数値入力 |
| frontTaperLength | 0 | length | 0.5 | 10 | スライダー + 数値入力（折りたたみ内） |
| rearTaperLength | 0 | length | 0.5 | 10 | スライダー（length-valで逆転表示） + 数値入力（折りたたみ内） |
| holeDepthFront | 0 | 30 | 0.5 | 10.0 | 数値入力のみ |
| holeDepthRear | 0 | 30 | 0.5 | 15.0 | 数値入力のみ |

- 寸法変更時の副作用: updateDimension呼出でshapeType='custom'に自動変更

### FR-003: 基本形状選択
- トルピード選択時: frontTaperLength=15, rearTaperLength=15
- ストレート選択時: frontTaperLength=5, rearTaperLength=5
- カスタム: 自動（updateDimension経由で設定）
- UIは2ボタン（選択中はborder-blue-600 + bg-blue-50）

### FR-004: カットパターン管理

#### FR-004-1: カット追加ロジック
1. CutSelectorでタイプ選択
2. 配置位置計算:
   - 初期位置: center = length/2, start = center-5, end = center+5 (幅10mm)
   - 衝突判定: vertical以外のカットとのオーバーラップチェック
   - 衝突時: start=0から2mm刻みで10mm幅の空きスペース探索
   - 空きなし: alert("空きスペースが見つかりませんでした。既存のカットを調整してください。")
3. カット生成: id=ランダム9文字, デフォルトproperties={pitch:1.0, depth:0.5, itemCount:12}

#### FR-004-2: カット編集UI（タイプ別表示制御）
各カットカードに表示するコントロール:

| コントロール | 表示条件 | 範囲 |
|-------------|---------|------|
| 開始位置 (startZ) | 全タイプ | 0〜length, step=0.5 |
| 幅 (endZ - startZ) | 全タイプ | 1〜length, step=0.5 |
| 深さ (depth) | 全タイプ | 0.1〜1.0, step=0.05 |
| ピッチ (pitch) | vertical以外 | 0.1〜5.0, step=0.1 |
| カット数 (itemCount) | verticalのみ | 2〜48, step=1 |
| 溝幅 (cutWidth) | ring, ring_double, ring_triple, micro | 0.1〜pitch, step=0.05 |
| ギャップ幅 (gapWidth) | ring_double, ring_triple | 0.1〜pitch, step=0.05 |
| フラット幅 (flatWidth) | wing | 0.1〜pitch*0.9, step=0.1 |

#### FR-004-3: カット移動の衝突制御
- startZ変更時: 幅(endZ-startZ)を維持して移動、衝突時はスライダー操作をブロック
- 幅変更時: startZを固定してendZを変更、衝突時はブロック
- verticalカットは衝突チェックをスキップ（他カットと重複可能）

#### FR-004-4: CutSelector UI
- 4カテゴリのタブ切替:
  - 基本: ring, ring_double, ring_triple
  - 掛かり: shark, wing, step, stair
  - 形状: ring_r, ring_v, scallop, canyon
  - 特殊: micro, vertical
- 各カットにSVGアイコン付き
- グリッド: 4列, 高さ24(h-24), overflow-y-auto

### FR-005: リアルタイム重量・重心計算

#### 計算アルゴリズム
```
for each consecutive pair (p1, p2) in profile points:
  h = (p2.y - p1.y) / 10  // mm→cm
  r1 = p1.x / 10, r2 = p2.x / 10
  if h ≤ 0.000001: skip

  // 円錐台体積
  dv = (π * h / 3) * (r1² + r1*r2 + r2²)

  // 円錐台重心（底面p1からの相対位置）
  relativeZc = h * (r1² + 2*r1*r2 + 3*r2²) / (4 * (r1² + r1*r2 + r2²))
  zc = z1 + relativeZc

  volume += dv
  momentZ += dv * zc

// 穴体積減算
holeArea = π * 0.21²  // cm²
frontHoleVol = holeArea * (holeDepthFront / 10)
rearHoleVol = holeArea * (holeDepthRear / 10)
frontHoleCoG = (holeDepthFront / 10) / 2
rearHoleCoG = lengthCm - (holeDepthRear / 10) / 2

finalVolume = volume - frontHoleVol - rearHoleVol
finalMoment = momentZ - frontHoleVol*frontHoleCoG - rearHoleVol*rearHoleCoG

weight = max(0, finalVolume * density)
cogMm = (finalMoment / finalVolume) * 10
```

#### 表示
- 重量: {physics.weight.toFixed(2)} g
- 重心: {physics.centerOfGravity.toFixed(1)} mm（前側からの距離）
- 計算タイミング: useMemoで依存値変更時に再計算

### FR-006: 素材選択

#### Editorでの選択（セレクトボックス）
| 表示ラベル | density値 |
|-----------|----------|
| タングステン95% (18.0g/cm³) | 18.0 |
| タングステン90% (17.0g/cm³) | 17.0 |
| タングステン80% (15.0g/cm³) | 15.0 |
| タングステン70% (13.5g/cm³) | 13.5 |

#### SpecWizardでの選択（スライダー）
- 範囲: 70〜97%, step=1
- 密度計算: density = 19.3 * (tungsten/100) + 8.9 * (1 - tungsten/100)

### FR-007: データ永続化

#### LocalStorage
- キー: 'dart-barrel-design'
- 保存フィールド: length, maxDiameter, cuts, materialDensity, frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear
- **注意（既知の不整合）**: outline, shapeTypeが保存対象外

#### JSONエクスポート
- ファイル名: 'my-barrel.json'
- 内容: 上記フィールド + timestamp (ISO8601)
- 方法: Blob → URL.createObjectURL → <a>.click()

#### JSONインポート
- FileReader → JSON.parse → Partial<BarrelState>

### FR-008: PDF図面インポート（OCR）
- ライブラリ: pdfjs-dist（動的import）、Tesseract.js（動的import）
- Worker: `https://unpkg.com/pdfjs-dist@{version}/build/pdf.worker.min.mjs`
- 処理フロー:
  1. pdfjs-distでテキスト直接抽出
  2. length/maxDiameterが取れない場合→OCRフォールバック
  3. OCR: scale=2.0でレンダリング → Tesseract (eng+jpn)
- 正規表現パターン:
  - 全長: `/(?:全長|Length)[\s:：]*([0-9.]+(?:\s?mm)?)/i`
  - 最大径: `/(?:最大径|Max\s*Diameter|Max\s*Dia)[\s:：]*([0-9.]+(?:\s?mm)?)/i`
  - 重量: `/(?:重量|Weight)[\s:：]*([0-9.]+(?:\s?g)?)/i`

### FR-009: AI図面解析（Gemini）
- モデル: gemini-2.0-flash-exp
- 認証フロー:
  1. パスワード入力モーダル表示
  2. 正解='OG2031'で認証
  3. 失敗カウント: localStorage 'gemini_ai_lockout_count'
  4. 3回失敗: localStorage 'gemini_ai_is_locked'='true' → 永続ロック
- APIキー: process.env.NEXT_PUBLIC_GEMINI_API_KEY || localStorage 'gemini_api_key'
- 処理: PDF 1ページ目 → Canvas(scale=2.0) → JPEG base64 → Gemini API
- プロンプト: 3段階指示（寸法読取→特徴特定→JSON生成）
- 反映時のデータ変換:
  - rearTaperLength = rearTaperStartZがある場合: (specs.length || length) - specs.rearTaperStartZ
  - cuts: typeバリデーション（無効→'ring'フォールバック）、id自動生成

### FR-010: スペック入力ウィザード
- 表示条件: showWizard=true（デフォルト=true、再ヒアリングボタンで再表示）
- body overflow=hidden（スクロール防止）
- 3ステップ:
  1. 全長(45.0) + 最大径(7.0) の数値入力
  2. 形状選択ボタン（torpedo → taper=15/15, straight → taper=5/5）
  3. タングステン%スライダー(70-97, default=90)
- 完了時: setAll({shapeType, length, maxDiameter, materialDensity, frontTaperLength, rearTaperLength, cuts:[], outline:[]})

### FR-011: 3Dシーン操作
- Canvas: shadows=true, camera position=[40,30,60], fov=35
- 環境: Environment preset='city'
- 照明: ambientLight(0.4) + directionalLight(position=[10,10,10], intensity=1.5, castShadow)
- 影: ContactShadows(resolution=1024, scale=20, blur=1, opacity=0.5, far=10, color=#000000)
- コントロール: OrbitControls(makeDefault, target=[0,0,0])
- カメラリセット: target=(0,0,0), position=(40,30,60)
- ラベル:
  - 前ラベル: position=[0, 0, -length/2 - 8], fontSize=モバイル2.5/PC4, labelY=モバイル8/PC4
  - 後ラベル: position=[0, 0, length/2 + 8], 同設定
  - Billboard(follow=true), Text(depthTest=false, fontWeight=bold, color=#111)
- モバイル判定: window.innerWidth < 768

---

## 3. 非機能要件

### NFR-001: パフォーマンス
- 目標: Lighthouse Performance > 90
- 手段: useMemoによるジオメトリキャッシュ
- 懸念: 全長150mmの場合、プロファイル点数=1500。×(内穴壁+外面+内穴壁)で更に増加。×65頂点/点 = ~10万頂点。スマホでの描画負荷要検証。

### NFR-002: レスポンシブデザイン
- モバイル(<768px): 3Dビュー=上部40vh, エディタ=下部60vh(absolute bottom-0, rounded-t-2xl)
- デスクトップ(≥768px): 3Dビュー=全画面, エディタ=右サイドバー(w-80=320px, border-l)
- 背景: bg-zinc-50 dark:bg-zinc-950
- エディタ: bg-white/95 dark:bg-zinc-900/95 backdrop-blur

### NFR-003: ダークモード対応
- Tailwind dark:クラスで対応済み
- OS設定連動（prefers-color-scheme）

### NFR-004: セキュリティ
- AI機能パスワード保護（クライアントサイド、低セキュリティ）
- APIキーはクライアント公開型（NEXT_PUBLIC_）

---

## 4. データモデル

### 型定義

```typescript
// カットタイプ（14種）
type CutType =
  | 'ring' | 'ring_double' | 'ring_triple'
  | 'ring_r' | 'ring_v'
  | 'canyon' | 'step' | 'stair'
  | 'scallop' | 'shark' | 'wing'
  | 'micro' | 'vertical' | 'none';

// カットゾーン
interface CutZone {
  id: string;
  type: CutType;
  startZ: number;  // mm from front
  endZ: number;    // mm from front
  properties: {
    pitch?: number;     // mm (default 1.0)
    depth?: number;     // mm (default 0.5)
    itemCount?: number; // vertical用 (default 12)
    cutWidth?: number;  // mm, ring系用
    gapWidth?: number;  // mm, double/triple用
    flatWidth?: number; // mm, wing用
  }
}

// アウトラインポイント
interface OutlinePoint {
  z: number;  // mm from front
  d: number;  // diameter mm
}

// バレル状態
interface BarrelState {
  length: number;            // mm, default=45.0
  maxDiameter: number;       // mm, default=7.0
  frontTaperLength: number;  // mm, default=10
  rearTaperLength: number;   // mm, default=10
  shapeType: 'torpedo' | 'straight' | 'custom';
  outline: OutlinePoint[];
  materialDensity: number;   // g/cm³, default=17.0
  holeDepthFront: number;    // mm, default=10.0
  holeDepthRear: number;     // mm, default=15.0
  cuts: CutZone[];
  cameraResetTrigger: number;
  // ... actions省略
}

// 物理計算結果
interface PhysicsData {
  volume: number;          // cm³
  weight: number;          // g
  centerOfGravity: number; // mm from front
}

// PDF解析結果
interface ExtractedSpecs {
  length?: number;
  maxDiameter?: number;
  weight?: number;
  frontTaperLength?: number;
  rearTaperLength?: number;
  rearTaperStartZ?: number;
  outline?: { z: number; d: number }[];
  cuts?: { type: string; startZ: number; endZ: number; properties?: any }[];
}
```

### データフロー図
```
[SpecWizard/Editor UI] → [useBarrelStore (Zustand)] → [useMemo]
                                                         ├→ generateProfile() → calculatePhysics() → [物理値表示]
                                                         └→ generateBarrelGeometry() → [Barrel mesh]

[PDFUploader] → ExtractedSpecs → [setAll/updateDimension] → [useBarrelStore]

[LocalStorage/JSON] ←→ [saveToLocalStorage/exportToJson/importFromJson]
```

---

## 5. 画面構成

### レイアウト階層
```
<main> (flex, h-screen, overflow-hidden)
├── <h1> BARREL LAB. (absolute, top-4 left-6, z-10, pointer-events-none)
├── <button> カメラリセット (absolute, top-4 right-4, z-10)
├── <div> 3Dシーン (absolute, top-0 left-0)
│   ├── モバイル: w-full h-[40vh] border-b
│   └── デスクトップ: inset-0 h-full
│   └── <Scene>
│       ├── <Canvas> (shadows, fov=35)
│       │   ├── <Environment preset="city" />
│       │   ├── <ambientLight intensity={0.4} />
│       │   ├── <directionalLight />
│       │   ├── <group>
│       │   │   ├── <Barrel />
│       │   │   ├── 前ラベル (Billboard Text)
│       │   │   └── 後ラベル (Billboard Text)
│       │   ├── <ContactShadows />
│       │   └── <OrbitControls />
├── <Editor> (z-20, overlay)
│   ├── モバイル: absolute bottom-0 w-full h-[60vh] rounded-t-2xl
│   └── デスクトップ: md:top-0 md:right-0 md:h-full md:w-80
│   └── (scrollable content)
│       ├── ヘッダー + 再ヒアリングボタン
│       ├── PDFUploader
│       ├── スペック表示（重量・重心）
│       ├── 素材選択
│       ├── 基本形状選択
│       ├── テーパー詳細（details/summary）
│       ├── 穴深さ設定
│       ├── 全長・最大径スライダー
│       ├── CutSelector（タブ付きグリッド）
│       ├── カット一覧（各カード：タイプ選択/位置/幅/深さ/ピッチ/他）
│       └── 保存/読込/エクスポート/インポート
└── [SpecWizard] (fixed, z-100, モーダルオーバーレイ)
    └── 3ステップウィザード
```

---

## 6. 技術制約

- **フレームワーク**: Next.js 16 (App Router), React 19
- **3D**: React Three Fiber + drei + three.js
- **状態管理**: Zustand
- **スタイル**: Tailwind CSS v4
- **ビルド**: Turborepo + pnpm 9.15.0
- **デプロイ**: Vercel
- **禁止**: CommonJS, any型, @ts-ignore
- **分離原則**: 3DロジックとReact状態管理は明確に分離

---

## 7. 既知の問題・改善項目

### 7.1 データ保存の不整合（バグ）
- LocalStorage/JSONエクスポートにoutline, shapeTypeが含まれていない
- → カスタムアウトラインやAI解析結果が保存されない

### 7.2 ハードコード定数（設定不可）
| 定数 | 値 | 場所 | 影響 |
|------|---|------|------|
| tipRadius | 2.9mm | generator.ts:21 | 先端径固定 |
| threadRadius | 2.9mm | generator.ts:22 | ネジ端径固定 |
| holeRadius | 2.1mm | generator.ts:242, physics.ts:45 | 穴径固定(2BA) |
| radialSegments | 64 | generator.ts:287 | 描画品質/負荷 |
| profileResolution | 0.1mm | generator.ts:18 | プロファイル精度 |
| threadPitch | 0.8mm | generator.ts:354 | ネジ山表現 |
| threadDepth | 0.15mm | generator.ts:355 | ネジ山表現 |
| holeWallRes | 0.2mm | generator.ts:249 | 穴壁精度 |
| カット追加幅 | 10mm | Editor.tsx:50 | 初期カット幅 |

### 7.3 セキュリティ懸念
- パスワード 'OG2031' がクライアントソースに平文
- NEXT_PUBLIC_GEMINI_API_KEY がクライアント公開

### 7.4 UI/メタデータ
- layout.tsx: title="Create Next App"（未更新）
- html lang="en"（日本語アプリ）

### 7.5 計算精度の限界
- 穴体積は円柱近似（ネジ山体積を無視）
- 縦カットの体積減算が2Dプロファイルベースの物理計算に反映されない

### 7.6 テスト不在
- ユニットテストなし（重量計算ロジック等のテスト推奨）

### 7.7 PDFUploader内の型安全性
- ExtractedSpecs.cuts[].propertiesが`any`型（@ts-ignore回避のためにeslint-disableコメント使用）
