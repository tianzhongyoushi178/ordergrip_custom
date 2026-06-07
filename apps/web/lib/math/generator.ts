import * as THREE from 'three';
import { CutZone, EndShape, OutlineInterp, PolygonZone, ColorZone } from '../store/useBarrelStore';

/**
 * アウトラインの d(z) を制御点間で補間する。
 * 'linear': 折れ線
 * 'smooth': Catmull-Rom 相当の cubic Hermite (中央差分接線、非一様 z 対応)
 *
 * @param points z 昇順ソート済みの制御点。長さ >= 2 を想定。
 */
const interpolateOutline = (
    z: number,
    points: { z: number; d: number }[],
    mode: OutlineInterp,
): number => {
    const n = points.length;
    if (n === 0) return 0;
    if (z <= points[0].z) return points[0].d;
    if (z >= points[n - 1].z) return points[n - 1].d;

    // 現在のセグメント [points[i], points[i+1]] を探索
    let i = 0;
    for (let k = 0; k < n - 1; k++) {
        if (z >= points[k].z && z <= points[k + 1].z) {
            i = k;
            break;
        }
    }
    const p0 = points[i];
    const p1 = points[i + 1];
    const dz = p1.z - p0.z;
    if (dz < 1e-9) return p0.d;
    const t = (z - p0.z) / dz;

    if (mode === 'linear' || n < 3) {
        return p0.d + (p1.d - p0.d) * t;
    }

    // 接線 (中央差分、端点は片側差分)
    const m0 = i > 0
        ? (p1.d - points[i - 1].d) / (p1.z - points[i - 1].z)
        : (p1.d - p0.d) / dz;
    const m1 = i + 2 < n
        ? (points[i + 2].d - p0.d) / (points[i + 2].z - p0.z)
        : (p1.d - p0.d) / dz;

    // Cubic Hermite 基底関数
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return h00 * p0.d + h10 * dz * m0 + h01 * p1.d + h11 * dz * m1;
};

/** 前後端の形状を計算: テーパー(直線) or R(楕円弧).
 *  前端:  z=0 で tipR、z=taperLen で baseR
 *  後端:  z=length で threadR、z=length-taperLen で baseR
 */
const endRadius = (
    distFromEnd: number, // 端からの距離 (mm). 0=端、taperLen=baseに到達
    taperLen: number,
    endR: number,
    baseR: number,
    shape: EndShape
): number => {
    if (taperLen <= 0) return baseR;
    const t = Math.min(1, Math.max(0, distFromEnd / taperLen));
    if (shape === 'round') {
        // 凹R: 楕円弧で先端付近は細いまま、根元で急に膨らむ。
        // r = baseR - (baseR-endR) * sqrt(1 - t^2)
        return baseR - (baseR - endR) * Math.sqrt(Math.max(0, 1 - t * t));
    }
    if (shape === 'convex') {
        // 凸R: 凹Rを反転した楕円弧。先端からすぐ膨らみ、根元で平坦に。
        // r = endR + (baseR-endR) * sqrt(1 - (1-t)^2)
        const u = 1 - t;
        return endR + (baseR - endR) * Math.sqrt(Math.max(0, 1 - u * u));
    }
    // 直線テーパー
    return endR + (baseR - endR) * t;
};

// ローレット/スパイラル/縦溝の円周方向分割数。3D生成(generateBarrelGeometry)と
// プロファイルのZ分解能(generateProfile)で共有し、斜め溝の段差幅(=列間隔)を一致させる。
// 本数が少ないと従来は分割が粗く(6×本数/溝幅比)、太い斜め溝の縁が階段状に目立った。
// 下限 KNURL_RADIAL_MIN を設けて本数が少なくても円筒・斜め溝を滑らかに保つ。
const KNURL_MIN_VERTS_PER_GROOVE = 6;
const KNURL_MIN_GROOVE_FRACTION = 0.05;
const KNURL_RADIAL_MIN = 384;   // 円周分割の下限(段差幅を細かく＝滑らかに保つ。性能との両立で384)
const KNURL_RADIAL_MAX = 1024;  // 上限(性能ガード)

/** ローレット系カット(縦溝/斜目/綾目)があるときの円周方向分割数。無ければ 0。 */
const knurlRadialSegments = (cuts: CutZone[]): number => {
    const knurlCuts = cuts.filter(
        (c) => c.type === 'vertical' || c.type === 'helical' || c.type === 'cross',
    );
    if (knurlCuts.length === 0) return 0;
    let required = KNURL_RADIAL_MIN;
    let maxVCount = 0;
    for (const k of knurlCuts) {
        const count = Math.max(1, k.properties.itemCount ?? 12);
        const gf = Math.max(KNURL_MIN_GROOVE_FRACTION, k.properties.grooveFraction ?? 0.5);
        required = Math.max(required, Math.ceil((count * KNURL_MIN_VERTS_PER_GROOVE) / gf));
        if (count > maxVCount) maxVCount = count;
    }
    // 溝本数の倍数に揃える(本数で割り切れないと溝位置がエイリアスするため)
    const rs = maxVCount > 0 ? Math.ceil(required / maxVCount) * maxVCount : required;
    return Math.min(rs, KNURL_RADIAL_MAX);
};

/**
 * 3Dメッシュ用に、ねじれローレット/スパイラル(helical/cross)の区間だけ Z サンプルを
 * 細かくした z 値の配列を返す。斜め溝が「円周×Z」格子に対し斜行して階段状(ギザギザ)に
 * なるのを抑える。段差幅は円周分割の列間隔(2π/radialSeg)で決まるので、1ステップで溝が
 * 動く量がその ~1列以下になるよう刻みを決める。ねじれが無ければ null(=一様で良い)。
 *
 * @param radialSeg 円周方向分割数(knurlRadialSegments の戻り値)
 * @param baseRes   ねじれ区間外の刻み mm (generateProfile の resolution と一致させる)
 */
const knurlMeshZSamples = (
    cuts: CutZone[],
    length: number,
    radialSeg: number,
    baseRes: number,
): number[] | null => {
    if (radialSeg <= 0) return null;
    const colSpacing = (Math.PI * 2) / radialSeg; // 列間隔 rad
    const TWIST_RES_MIN = 0.022;     // 最細 mm (性能下限)
    const COLS_PER_STEP = 1.2;       // 1ステップで溝が動いてよい列数(列が細いので1列強でも目立たない)
    const MAX_ROWS_PER_ZONE = 800;   // 1区間の行数上限(頂点爆発の防止)
    const twistedZones = cuts
        .filter((c) => (c.type === 'helical' || c.type === 'cross') && (c.properties.twistDeg ?? 0) !== 0)
        .map((c) => {
            const start = Math.max(0, c.startZ);
            const end = Math.min(length, c.endZ);
            const zoneLen = Math.max(1e-6, end - start);
            const twistRate = (Math.abs(c.properties.twistDeg ?? 0) * Math.PI) / 180 / zoneLen; // rad/mm
            let res = twistRate > 1e-9 ? (COLS_PER_STEP * colSpacing) / twistRate : baseRes;
            res = Math.min(baseRes, Math.max(TWIST_RES_MIN, res));
            res = Math.max(res, zoneLen / MAX_ROWS_PER_ZONE);
            return { start, end, res };
        })
        .filter((zone) => zone.end > zone.start);
    if (twistedZones.length === 0) return null; // ねじれ区間なし(縦溝のみ等)→一様で可

    const resAt = (zz: number): number => {
        let s = baseRes;
        for (const t of twistedZones) {
            if (zz >= t.start - 1e-9 && zz < t.end - 1e-9) s = Math.min(s, t.res);
        }
        return s;
    };
    // baseRes(0.1mm)グリッドを必ず保持しつつ、ねじれ区間に重なる各グリッド区間を res で
    // 整数分割する(=スーパーセット)。これで 0.1mm の頂点(リング溝の谷/山など)が常に存在し、
    // かつ斜め溝が滑らかになる。スナップで累積ドリフトも除去。
    const snap = (v: number): number => Math.round(v * 1e6) / 1e6;
    const zs: number[] = [0];
    const nBase = Math.ceil(length / baseRes);
    let prev = 0;
    for (let i = 1; i <= nBase; i++) {
        const gz = Math.min(length, snap(i * baseRes)); // 0.1mm グリッド点
        const res = resAt((prev + gz) / 2);
        const k = res < baseRes - 1e-9 ? Math.max(1, Math.ceil((gz - prev) / res)) : 1;
        for (let j = 1; j <= k; j++) zs.push(snap(prev + ((gz - prev) * j) / k));
        prev = gz;
    }
    return zs;
};

export const generateProfile = (
    length: number,
    maxDiameter: number,
    cuts: CutZone[],
    frontTaperLen: number = 10,
    rearTaperLen: number = 10,
    outline: { z: number, d: number }[] = [],
    frontEndShape: EndShape = 'taper',
    rearEndShape: EndShape = 'taper',
    outlineInterp: OutlineInterp = 'smooth',
): THREE.Vector2[] => {
    const points: THREE.Vector2[] = [];
    const baseRadius = maxDiameter / 2;

    // Resolution: higher = smoother but more vertices. 
    // 0.1mm is good for visual fidelity of cuts.
    const resolution = 0.1;

    // End radii (only used if no outline)
    const tipRadius = 2.9; // 5.8mm diameter
    const threadRadius = 2.9; // 5.8mm diameter

    // Sort outline points by Z just in case
    const sortedOutline = [...outline].sort((a, b) => a.z - b.z);

    // 注: ねじれローレット/スパイラルの斜め溝の階段(ギザギザ)対策(Z方向の細分化)は
    // 3Dメッシュ生成側(generateBarrelGeometry)で行う。ここ(2D外形プロファイル=物理/DXF用)は
    // ローレットの影響を受けない一様サンプリングのまま保つ。
    const steps = Math.ceil(length / resolution);
    for (let i = 0; i <= steps; i++) {
        const z = i === steps ? length : i * resolution;

        let r = baseRadius;

        // 1. Basic Shape Profile
        if (sortedOutline.length > 1) {
            // --- OUTLINE INTERPOLATION (linear or Catmull-Rom smooth) ---
            r = interpolateOutline(z, sortedOutline, outlineInterp) / 2;
        } else {
            // --- TRADITIONAL END SHAPING (Fallback) ---
            // Front End (taper or round)
            if (z < frontTaperLen) {
                r = endRadius(z, frontTaperLen, tipRadius, baseRadius, frontEndShape);
            }
            // Rear End (taper or round)
            else if (z > length - rearTaperLen) {
                r = endRadius(length - z, rearTaperLen, threadRadius, baseRadius, rearEndShape);
            }
        }

        // 2. Apply Cuts
        for (const cut of cuts) {
            if (z >= cut.startZ && z < cut.endZ) {
                const depth = cut.properties.depth || 0.5;
                const pitch = cut.properties.pitch || 1.0;

                // Relative Z in the cut zone
                const localZ = z - cut.startZ;

                // --- CUT PROFILE LOGIC ---
                // 周方向加工 (縦溝/斜目/綾目) は 3D 生成で処理。2D プロファイル(=物理)からは除外。
                if (cut.type === 'vertical' || cut.type === 'helical' || cut.type === 'cross') continue;

                // factor: 0.0 to 1.0 (0=Start of pitch, 1=End of pitch)
                const cycle = localZ % pitch;
                const rawFactor = cycle / pitch; // 0.0 -> 1.0

                // For non-groove types, support active width (cutWidth < pitch = flat land after pattern)
                // shark は peak のピン角を保つため常に full pitch をスパンする
                // wing は shark + 溝間隔 (land) として activeWidth を使用する
                const isGrooveType = cut.type === 'ring' || cut.type === 'micro'
                    || cut.type === 'ring_double' || cut.type === 'ring_triple';
                const isFullPitchType = cut.type === 'shark';
                let factor = rawFactor;
                if (!isGrooveType && !isFullPitchType) {
                    const activeWidth = cut.properties.cutWidth;
                    if (activeWidth !== undefined && activeWidth < pitch) {
                        const activeFraction = activeWidth / pitch;
                        if (rawFactor >= activeFraction) continue; // flat land area
                        factor = rawFactor / activeFraction; // remap to 0..1
                    }
                }

                switch (cut.type) {
                    case 'ring':
                    case 'micro': {
                        // |__|-- Adjustable groove width
                        const cwRing = Math.min(cut.properties.cutWidth ?? pitch * 0.5, pitch * 0.95);
                        if (factor < cwRing / pitch) r -= depth;
                        break;
                    }

                    case 'ring_double': {
                        // ||_||_-- Two grooves with adjustable width and gap
                        const cwD = cut.properties.cutWidth ?? pitch * 0.2;
                        const gwD = cut.properties.gapWidth ?? pitch * 0.15;
                        const cwDR = cwD / pitch;
                        const gwDR = gwD / pitch;
                        if (factor < cwDR || (factor >= cwDR + gwDR && factor < 2 * cwDR + gwDR)) {
                            r -= depth;
                        }
                        break;
                    }

                    case 'ring_triple': {
                        // ||_||_||-- Three grooves with adjustable width and gap
                        const cwT = cut.properties.cutWidth ?? pitch * 0.15;
                        const gwT = cut.properties.gapWidth ?? pitch * 0.1;
                        const cwTR = cwT / pitch;
                        const gwTR = gwT / pitch;
                        const g1 = cwTR;
                        const g2s = cwTR + gwTR;
                        const g2 = 2 * cwTR + gwTR;
                        const g3s = 2 * cwTR + 2 * gwTR;
                        const g3 = 3 * cwTR + 2 * gwTR;
                        if (factor < g1 || (factor >= g2s && factor < g2) || (factor >= g3s && factor < g3)) {
                            r -= depth;
                        }
                        break;
                    }

                    case 'shark':
                        // /|  (Shark cut)
                        // Front side = taper (gradual slope up), rear side = steep wall
                        // factor 0: valley (front), factor 1: peak (rear), then steep drop
                        r -= depth * (1 - factor);
                        break;

                    case 'wing':
                        // Wing = Shark + 溝間隔 (land between teeth)
                        // 全て直線。 active 区間内では shark と同じ線形ランプ。
                        // active 外 (cutWidth < pitch) は上の活性幅ロジックで continue 済 (land at peak)。
                        //  /|     /|     /|
                        // / | _  / | _  / | _   ← shark teeth with peak-land (溝間隔) between
                        r -= depth * (1 - factor);
                        break;

                    case 'ring_v':
                        // V-shape \/
                        // 0->0.5: down, 0.5->1.0: up
                        if (factor < 0.5) {
                            r -= depth * (factor / 0.5);
                        } else {
                            r -= depth * ((1.0 - factor) / 0.5);
                        }
                        break;

                    case 'ring_r':
                    case 'scallop':
                        // U-shape / Semi-circle (
                        // Sin wave
                        r -= depth * Math.sin(factor * Math.PI);
                        // Note: Scallop usually implies wider/shallower, R-ring deeper/narrower. 
                        // Visual difference is mainly pitch/depth ratio which user controls.
                        break;

                    case 'canyon':
                        // \___/
                        // 20% taper, 60% flat, 20% taper
                        if (factor < 0.2) {
                            r -= depth * (factor / 0.2);
                        } else if (factor < 0.8) {
                            r -= depth;
                        } else {
                            r -= depth * ((1.0 - factor) / 0.2);
                        }
                        break;

                    case 'step':
                        // Land → Mid → Deep（前→後方向で段差が掛かる）
                        // |  --|__| 段差カット
                        if (factor < 0.3) {
                            // Land（削りなし）
                        } else if (factor < 0.6) {
                            r -= depth * 0.5; // Mid step
                        } else {
                            r -= depth; // Deep
                        }
                        break;

                    case 'stair':
                        // ステップの両方向版: 前後どちらからも掛かる対称形
                        // Ramp down → Deep → Ramp up → Land
                        if (factor < 0.2) {
                            r -= depth * (factor / 0.2); // Ramp down
                        } else if (factor < 0.5) {
                            r -= depth; // Deep flat
                        } else if (factor < 0.7) {
                            r -= depth * (1 - (factor - 0.5) / 0.2); // Ramp up
                        }
                        // 0.7-1.0: Land
                        break;

                    default:
                        // Fallback to Ring
                        if (factor < 0.5) r -= depth;
                        break;
                }
            }
        }

        // Clamp radius to min 0.5mm to avoid artifacts or holes
        if (r < 0.5) r = 0.5;

        points.push(new THREE.Vector2(r, z));
    }

    return points;
};

/**
 * 正多角形の半径係数。円周半径(頂点までの距離)を 1 としたとき、角度 theta
 * における多角形境界までの距離の比率を返す。頂点方向で 1、辺の中央で cos(π/N)。
 * 頂点は theta = k·(2π/N) (k 整数) に位置する。sides < 5 は真円とみなし 1 を返す。
 */
export const polygonRadiusFactor = (theta: number, sides: number): number => {
    if (sides < 5) return 1;
    const seg = (Math.PI * 2) / sides;
    let local = theta % seg;
    if (local < 0) local += seg;
    return Math.cos(Math.PI / sides) / Math.cos(local - Math.PI / sides);
};

/**
 * 正 N 角形(円周半径 R)の断面積 ÷ 同半径の円の断面積 = N·sin(2π/N) / (2π)。
 * 物理計算で多角形断面の体積をスケールするのに使う。sides < 5 は 1 を返す。
 */
export const polygonAreaFactor = (sides: number): number => {
    if (sides < 5) return 1;
    return (sides * Math.sin((Math.PI * 2) / sides)) / (Math.PI * 2);
};

/**
 * Z 位置 z を含む最初の多角形ゾーンの角数を返す。該当ゾーンが無ければ 0 (真円)。
 * generator / physics(呼び出し側) / dxf で共用する区間判定。
 */
export const polygonSidesAt = (zones: PolygonZone[], z: number): number => {
    for (const zone of zones) {
        if (zone.sides >= 5 && z >= zone.startZ && z < zone.endZ) return zone.sides;
    }
    return 0;
};

/** z がいずれかのカラー区間内なら true (外周面の着色判定に使う)。 */
export const isColoredAt = (zones: ColorZone[], z: number): boolean => {
    for (const zone of zones) {
        if (z >= zone.startZ && z < zone.endZ) return true;
    }
    return false;
};

/** 3D生成・物理計算で共有する「上面のみ」フェード幅 (mm)。溝肩でこの距離をかけて掘り込みを0にする。 */
export const KNURL_LAND_FADE_MM = 0.1;

/** 溝底形状ごとの「溝内平均深さ係数」(溝全幅にわたる depthFactor の平均)。3D生成の depthFactor と整合。 */
const knurlAvgDepthFactor = (bottomShape: 'flat' | 'v' | 'round'): number => {
    switch (bottomShape) {
        // V字: 中央最深の三角。平均 = 0.5
        case 'v': return 0.5;
        // 丸底(sin半周): 平均 = 2/π
        case 'round': return 2 / Math.PI;
        // フラット底 + 両端 10% のエッジ遷移。平均 = 1 - edgeWidth = 0.9
        case 'flat':
        default: return 0.9;
    }
};

/** 溝底形状ごとの「溝内 depthFactor² の平均」。除去断面積の二次補正 ∫rMod²/2 に使う。 */
const knurlAvgDepthFactorSq = (bottomShape: 'flat' | 'v' | 'round'): number => {
    switch (bottomShape) {
        // V字(三角): ∫₀¹(1-2|t-0.5|)² dt = 1/3
        case 'v': return 1 / 3;
        // 丸底(sin半周): ∫₀¹ sin²(πt) dt = 1/2
        case 'round': return 0.5;
        // フラット底 + 両端10%エッジ遷移: 0.8 + 2·(0.1/3) ≈ 0.8667
        case 'flat':
        default: return 0.8 + 2 * (0.1 / 3);
    }
};

/** ローレット系カットの入力を 3D生成・物理計算で共通に正規化した結果。 */
interface SanitizedKnurlProps {
    depthMm: number;        // 掘り込み深さ mm (>0、不正値は既定 0.5)
    grooveFraction: number; // 溝の角度占有比 0〜0.95
    bottomShape: 'flat' | 'v' | 'round';
}

/**
 * ローレット系カット(縦溝/斜目/綾目)の入力プロパティを正規化する。
 * NaN・負・範囲外などの不正値を丸め、見た目(3D)と重量(物理)で必ず同じ値を使わせる
 * (片方だけ削れる/重量だけ増える といった不整合を防ぐ)。
 */
const sanitizeKnurlProps = (p: CutZone['properties']): SanitizedKnurlProps => {
    const d = p.depth;
    const depthMm = Number.isFinite(d) && (d as number) > 0 ? (d as number) : 0.5;
    const gf = p.grooveFraction;
    const grooveFraction = Number.isFinite(gf) ? Math.min(0.95, Math.max(0, gf as number)) : 0.5;
    const bottomShape = p.bottomShape ?? 'flat';
    return { depthMm, grooveFraction, bottomShape };
};

/**
 * ローレット/スパイラル(縦溝/斜目/綾目)が外周面から除去する「断面積(cm²)」を Z 位置ごとに返す関数を作る。
 * physics の円錐台積分から減算して重量・重心に反映する。3D生成の「上面のみ」適用と整合させるため、
 * リング溝等で凹んだ Z ではエンベロープからの凹み量に応じてフェードさせる(掘り込まない)。
 *
 * 近似モデル: ある Z 断面で周方向に占める溝角度比 = grooveFraction (綾目は交差ぶん 1-(1-gf)²)、
 * 溝内平均深さ係数 avgDF、深さ vDepth。円環シェルの除去面積 ≈ 2π·(r·avgDF·vDepth - avgDF2·vDepth²/2)·gfEff·weight。
 * 多角形ゾーン内でも外周を円(2πr)で近似する(多角形フラットぶんの周長差は無視)。
 *
 * @returns (zMidMm, rMidCm) -> 除去断面積 cm² 。ローレット系カットが無ければ常に 0 を返す。
 */
export const makeKnurlAreaRemovedFn = (
    cuts: CutZone[],
    length: number,
    maxDiameter: number,
    frontTaperLen: number = 10,
    rearTaperLen: number = 10,
    outline: { z: number; d: number }[] = [],
    frontEndShape: EndShape = 'taper',
    rearEndShape: EndShape = 'taper',
    outlineInterp: OutlineInterp = 'smooth',
): (zMidMm: number, rMidCm: number) => number => {
    const knurlCuts = cuts.filter(
        (c) => c.type === 'vertical' || c.type === 'helical' || c.type === 'cross',
    );
    if (knurlCuts.length === 0) return () => 0;

    // 凹み判定用エンベロープ(カットなし外形)。3D生成側の「上面のみ」基準と同じ。
    const env = generateProfile(
        length, maxDiameter, [], frontTaperLen, rearTaperLen, outline, frontEndShape, rearEndShape, outlineInterp,
    );
    // z(mm) -> エンベロープ半径(mm)。env は z 昇順なので二分探索で線形補間。
    const envRAtMm = (z: number): number => {
        const n = env.length;
        if (n === 0) return 0;
        if (z <= env[0].y) return env[0].x;
        if (z >= env[n - 1].y) return env[n - 1].x;
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (env[mid].y <= z) lo = mid; else hi = mid;
        }
        const a = env[lo], b = env[hi];
        return b.y === a.y ? a.x : a.x + (b.x - a.x) * ((z - a.y) / (b.y - a.y));
    };

    const fadeCm = KNURL_LAND_FADE_MM / 10;

    return (zMidMm: number, rMidCm: number): number => {
        // 上面のみ: リング溝等で凹んだ部分(cutDepth>0)はフェードして掘り込まない。
        const envRcm = envRAtMm(zMidMm) / 10;
        const cutDepthCm = Math.max(0, envRcm - rMidCm);
        const weight = cutDepthCm > 0 ? Math.max(0, 1 - cutDepthCm / fadeCm) : 1;
        if (weight <= 0) return 0;

        // 複数のローレット系カットが同じ Z に重なる場合、3D生成は角度ごとに最深の溝だけを
        // 採用する(rMod = max)。重量側も整合させ、加算ではなく最大の除去量を採る。
        // 注: 位相/本数が異なるローレットが重なると 3D は角度方向に union 的に削れるため、
        // 厳密な平均除去量は max と sum の間になる。ここでは保守的に max(過小側)で近似する
        // (過大評価=重量が軽く出る方向は避ける)。重なりは稀なケースのため許容。
        let area = 0; // cm²
        for (const c of knurlCuts) {
            if (zMidMm < c.startZ || zMidMm >= c.endZ) continue;
            const { depthMm, grooveFraction, bottomShape } = sanitizeKnurlProps(c.properties);
            const vDepthCm = depthMm / 10;
            // 綾目(cross)は逆向き2方向の交差。占有角度比は和-積(包除)で近似。
            const gfEff = c.type === 'cross'
                ? 1 - (1 - grooveFraction) * (1 - grooveFraction)
                : grooveFraction;
            // 溝の半径方向除去を厳密化: シェル断面積 = ∫(r·rMod - rMod²/2)dθ。
            // 一次項 r·avgDF·vDepth から二次項 avgDF2·vDepth²/2 を引く(浅溝での過大評価を抑制)。
            const avgDF = knurlAvgDepthFactor(bottomShape);
            const avgDF2 = knurlAvgDepthFactorSq(bottomShape);
            const shell = rMidCm * avgDF * vDepthCm - 0.5 * avgDF2 * vDepthCm * vDepthCm;
            const perCutArea = 2 * Math.PI * gfEff * Math.max(0, shell) * weight;
            area = Math.max(area, perCutArea);
        }
        return area;
    };
};

export const generateBarrelGeometry = (
    length: number,
    maxDiameter: number,
    cuts: CutZone[],
    frontTaperLen: number,
    rearTaperLen: number,
    holeDepthFront: number,
    holeDepthRear: number,
    outline: { z: number, d: number }[] = [],
    frontEndShape: EndShape = 'taper',
    rearEndShape: EndShape = 'taper',
    outlineInterp: OutlineInterp = 'smooth',
    polygonZones: PolygonZone[] = [],
    colorZones: ColorZone[] = [],
    accentColor: string = '#D1D5DB',
): THREE.BufferGeometry => {
    // 1. Get Base Profile (Outer surface only)
    const outerPoints = generateProfile(length, maxDiameter, cuts, frontTaperLen, rearTaperLen, outline, frontEndShape, rearEndShape, outlineInterp);

    // 円周方向分割数(ローレット系があれば共通ヘルパで算出)。本数に応じて溝幅に十分な
    // 頂点を確保しつつ、本数が少なくても下限 KNURL_RADIAL_MIN で円筒・斜め溝を滑らかに保つ。
    // メッシュ用Z細分化(knurlMeshZSamples)も同じ分割数を基準にするので段差幅とZ刻みが整合する。
    const knurlRS = knurlRadialSegments(cuts);

    // 多角形化の基準となる「カットなし外形エンベロープ」(リング溝等を除いた最大径輪郭)。
    // 多角形は外形のみに適用し、溝部分は円形に保つため、各 z でこのエンベロープ半径を参照する。
    // ローレット/スパイラル(縦溝/斜目/綾目)も同様に「凹んでいない上面(エンベロープ面)のみ」に
    // 掛け、リング溝などで削れた部分には掛けない。そのため凹み量算出用に、多角形が無くても
    // ローレット系カットがあればエンベロープを用意する。
    const hasPolygonZone = polygonZones.some((pz) => pz.sides >= 5);
    const hasKnurlCut = cuts.some((c) => c.type === 'vertical' || c.type === 'helical' || c.type === 'cross');
    const envOuter = (hasPolygonZone || hasKnurlCut)
        ? generateProfile(length, maxDiameter, [], frontTaperLen, rearTaperLen, outline, frontEndShape, rearEndShape, outlineInterp)
        : outerPoints;
    // z (バレル軸方向 mm) → エンベロープ半径。envOuter は z 昇順なので二分探索で線形補間。
    const envRAt = (z: number): number => {
        const n = envOuter.length;
        if (n === 0) return 0;
        if (z <= envOuter[0].y) return envOuter[0].x;
        if (z >= envOuter[n - 1].y) return envOuter[n - 1].x;
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (envOuter[mid].y <= z) lo = mid; else hi = mid;
        }
        const a = envOuter[lo], b = envOuter[hi];
        return b.y === a.y ? a.x : a.x + (b.x - a.x) * ((z - a.y) / (b.y - a.y));
    };

    // 2. Construct FULL Profile (Inner -> Outer -> Inner)
    // 2BA Hole Radius approx 2.1mm
    const holeRadius = 2.1;
    const points: THREE.Vector2[] = [];

    // --- FRONT HOLE INNER ---
    // Start from bottom of front hole (Center Axis) -> (Hole Radius)
    points.push(new THREE.Vector2(0.001, holeDepthFront));

    // Subdivide Front Hole Wall
    const holeWallRes = 0.2; // Resolution for threads
    for (let h = holeDepthFront; h >= 0; h -= holeWallRes) {
        if (h < 0) h = 0;
        points.push(new THREE.Vector2(holeRadius, h));
        if (h === 0) break;
    }

    // --- FRONT FACE ---
    // Connect Front Lip (last point was holeRadius, 0)
    // to Outer Profile Start (which is usually nearby)

    // --- OUTER SURFACE ---
    // ねじれローレット/スパイラルがある区間は Z を細分化して斜め溝の階段(ギザギザ)を抑える。
    // 2D外形(outerPoints)は一様サンプルのままなので、細分化した z で半径を線形補間して
    // メッシュ用の行列を作る(外形=物理/DXFには影響させない設計)。
    const radiusAtZ = (z: number): number => {
        const n = outerPoints.length;
        if (n === 0) return 0;
        if (z <= outerPoints[0].y) return outerPoints[0].x;
        if (z >= outerPoints[n - 1].y) return outerPoints[n - 1].x;
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (outerPoints[mid].y <= z) lo = mid; else hi = mid;
        }
        const a = outerPoints[lo], b = outerPoints[hi];
        return b.y === a.y ? a.x : a.x + (b.x - a.x) * ((z - a.y) / (b.y - a.y));
    };
    const meshZ = knurlMeshZSamples(cuts, length, knurlRS, 0.1);
    const outerForMesh = meshZ
        ? meshZ.map((z) => new THREE.Vector2(radiusAtZ(z), z))
        : outerPoints;
    // Append all outer points
    points.push(...outerForMesh);

    // --- REAR FACE ---
    // Connect Outer Profile End to Rear Lip

    // --- REAR HOLE INNER ---
    // Subdivide Rear Hole Wall
    // From Length (Lip) -> Length - Depth (Bottom)
    // Actually our order for Rear Hole was: Lip -> Wall Bottom -> Center.
    // So we iterate FROM Length DOWN TO Bottom.
    // Wait, the outer profile ends at `length`.
    // Next point is Rear Lip (holeRadius, length).
    // Then wall down to (holeRadius, length - depth).

    for (let z = length; z >= length - holeDepthRear; z -= holeWallRes) {
        // Prevent going below bottom
        if (z < length - holeDepthRear) z = length - holeDepthRear;
        points.push(new THREE.Vector2(holeRadius, z));
        if (z === length - holeDepthRear) break;
    }

    // Point N+2: Center Axis at Depth
    points.push(new THREE.Vector2(0.001, length - holeDepthRear));

    // 3. Build Mesh Data
    // Pre-filter circumferential (knurl) cuts: 縦溝/斜目/綾目 (3Dで周方向に溝を掘る)
    const knurlCuts = cuts.filter(c => c.type === 'vertical' || c.type === 'helical' || c.type === 'cross');

    // 周方向のサンプル列を構築する。各列は { theta, u, bridgeNext } を持ち、
    // bridgeNext=false の列は次列との間に面(quad)を張らない = ジオメトリの切れ目。
    //
    // 多角形は「区間ごとに角数が変わる」ため、全断面で共通の一様リングを使い、
    // 各断面で polygonSidesAt(y) に応じた多角形係数を半径に掛ける(スムース表現)。
    // 多角形ゾーンがある場合は flats を滑らかに見せるため解像度を引き上げる。
    const hasPolygon = polygonZones.some((z) => z.sides >= 5);
    const ring: { theta: number; u: number; bridgeNext: boolean }[] = [];
    // ローレット系があれば knurlRS(本数の倍数・下限480・上限1024で算出済)。無ければ
    // 多角形用に 128、それ以外は 64。
    let radialSegments = knurlRS > 0 ? knurlRS : (hasPolygon ? 128 : 64);
    if (hasPolygon) radialSegments = Math.max(radialSegments, 128);
    radialSegments = Math.min(radialSegments, KNURL_RADIAL_MAX);
    for (let j = 0; j <= radialSegments; j++) {
        ring.push({
            theta: (j / radialSegments) * Math.PI * 2,
            u: j / radialSegments,
            bridgeNext: j < radialSegments,
        });
    }
    const cols = ring.length;
    const heightSegments = points.length - 1;

    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    // 頂点カラー: ベース金属色 / アクセント色を THREE.Color で sRGB→linear 変換して焼き込む
    const baseColor = new THREE.Color('#D1D5DB');
    const accent = new THREE.Color(accentColor);

    // Generate Vertices
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const rBase = p.x;
        const y = p.y; // Z position along barrel length (0 to L)

        // Determine surface type based on Radius and Sequence
        // Inner Hole: Radius is close to holeRadius (2.1) AND it's not the Front/Rear Face connecting to outer.
        // Outer Surface: Radius is close to user defined profile (> holeRadius generally).
        // Front Face: Connects Hole to Outer.
        // Rear Face: Connects Outer to Hole.

        // Robust check:
        // Outer Surface: We know outerPoints range. But we concatenated them.
        // We can check if `p` comes from `outerPoints`.
        // Let's rely on Radius? 
        // 2BA = 2.1mm.
        // Barrel Min Dia usually > 5.5mm (r=2.75).
        // So anything r > 2.5 is Outer? 
        // Tapers might go down to 2.4? 
        // Tip Radius is 2.9 (r=1.45)?? No, Tip Diameter is 5.8 -> r=2.9.
        // My code says: const tipRadius = 2.9; (line 19)
        // So Outer surface is always r >= 2.9. 
        // Inner Hole is r = 2.1.

        let isInnerHole = false;
        let isOuterSurface = false;

        if (Math.abs(rBase - holeRadius) < 0.01) {
            isInnerHole = true;
        } else if (rBase > 2.5) {
            isOuterSurface = true;
        }

        // この断面の Z 位置(y)が属する多角形ゾーンの角数 (外周面のみ・無ければ 0=円)
        const sectionSides = isOuterSurface ? polygonSidesAt(polygonZones, y) : 0;
        // 外形(エンベロープ)からの凹み量。リング溝等で削れた部分は cutDepth>0 になる。
        // 多角形化・ローレット/スパイラルともに「凹んでいない上面のみ」へ適用するための重みに使う。
        const useEnvelope = isOuterSurface && (sectionSides >= 5 || hasKnurlCut);
        const envR = useEnvelope ? envRAt(y) : rBase;
        const cutDepth = useEnvelope ? Math.max(0, envR - rBase) : 0;
        const polyWeight = sectionSides >= 5 ? Math.max(0, 1 - cutDepth / 0.05) : 0;
        // 外周面かつカラー区間内なら accentColor、それ以外はベース金属色で着色
        const sectionColored = isOuterSurface && isColoredAt(colorZones, y);

        for (let jc = 0; jc < cols; jc++) {
            const { theta, u } = ring[jc];

            // 外形のみ多角形化: 凹み env*(1-factor) を外形部分(polyWeight≈1)にのみ適用。
            // 溝部分(polyWeight≈0)・穴・端面は円形のまま。
            const rSurf = sectionSides >= 5
                ? rBase - envR * (1 - polygonRadiusFactor(theta, sectionSides)) * polyWeight
                : rBase;

            let rMod = 0;

            // Apply modifications based on surface
            if (isOuterSurface) {
                // 周方向の溝 (縦溝/斜目/綾目)。斜目・綾目は Z に沿って溝をねじる。
                for (const kCut of knurlCuts) {
                    if (y >= kCut.startZ && y < kCut.endZ) {
                        const count = kCut.properties.itemCount || 12;
                        // 入力正規化は重量計算(makeKnurlAreaRemovedFn)と共通化し、見た目と重量を必ず一致させる。
                        const { depthMm: vDepth, grooveFraction, bottomShape } = sanitizeKnurlProps(kCut.properties);
                        const segmentRad = (Math.PI * 2) / count;

                        // ねじれ率 (rad/mm): vertical=0。total twistDeg をゾーン長で割る。
                        const zoneLen = Math.max(1e-6, kCut.endZ - kCut.startZ);
                        const twistRate = kCut.type === 'vertical'
                            ? 0
                            : ((kCut.properties.twistDeg ?? 0) * Math.PI / 180) / zoneLen;
                        // 溝の方向: 斜目=1本, 綾目=逆向き2本(交差), 縦溝=ねじれ無し
                        const dirs = kCut.type === 'cross' ? [1, -1] : kCut.type === 'helical' ? [1] : [0];
                        const localZ = y - kCut.startZ;

                        for (const dir of dirs) {
                            const shifted = theta + dir * twistRate * localZ;
                            let localTheta = (shifted % segmentRad) / segmentRad;
                            if (localTheta < 0) localTheta += 1; // 負の剰余を 0..1 に正規化

                            if (localTheta < grooveFraction) {
                                // 溝内の位置 (0=溝端, 0.5=中央, 1=溝端)
                                const gf = localTheta / grooveFraction; // 0..1
                                const edgeWidth = 0.1; // エッジ遷移幅（溝幅に対する比率）
                                let edgeFade = 1;
                                if (gf < edgeWidth) edgeFade = gf / edgeWidth;
                                else if (gf > 1 - edgeWidth) edgeFade = (1 - gf) / edgeWidth;

                                let depthFactor: number;
                                switch (bottomShape) {
                                    case 'v':
                                        // V字: 中央が最深
                                        depthFactor = 1 - 2 * Math.abs(gf - 0.5);
                                        break;
                                    case 'round':
                                        // U字/丸底: sin曲線
                                        depthFactor = Math.sin(gf * Math.PI);
                                        break;
                                    case 'flat':
                                    default:
                                        // フラット底 + エッジ遷移
                                        depthFactor = edgeFade;
                                        break;
                                }
                                rMod = Math.max(rMod, vDepth * depthFactor);
                            }
                        }
                    }
                }
                // 上面のみ: リング溝等で凹んだ部分(cutDepth>0)にはローレット/スパイラルを掛けない。
                // cutDepth が小さい上面(land)では全量、溝肩から溝内へ入るにつれフェードして 0 に。
                // フェード幅は物理計算(makeKnurlAreaRemovedFn)と共通の KNURL_LAND_FADE_MM。
                if (rMod > 0 && cutDepth > 0) {
                    rMod *= Math.max(0, 1 - cutDepth / KNURL_LAND_FADE_MM);
                }
            } else if (isInnerHole) {
                // Thread Simulation
                // 2BA Pitch approx 0.53mm ~ 0.8mm depending on standard. Let's use 0.6mm visually.
                // Thread depth approx 0.1mm - 0.2mm visually.
                const threadPitch = 0.8;
                const threadDepth = 0.15;

                // Simple sine wave based on Y (Length)
                // r -= depth * sin(...)
                // We want it to look like a spiral, but simple concentric rings look basically the same from inside.
                // Spiral: sin(y * freq + theta)?? 
                // Let's stick to concentric rings for simplicity and clean geometry.
                rMod = threadDepth * Math.sin(y * (Math.PI * 2 / threadPitch));

                // Note: We subtract rMod. So positive rMod means digging IN.
                // Threads stick IN and OUT relative to pitch diameter. 
                // Let's just oscillate.
            }

            const rFinal = Math.max(0.1, rSurf - rMod);

            const sin = Math.sin(theta);
            const cos = Math.cos(theta);

            // Vertices (Standard Lathe: Y is Up/Axis)
            // We map: p.x -> Radius, p.y -> Y coord (-y for length down)
            vertices.push(rFinal * sin);
            vertices.push(-y);
            vertices.push(rFinal * cos);

            // UVs
            uvs.push(u);
            // Map V based on distance along the profile path could be better,
            // but simple i/segments is okay for basic metal texture.
            uvs.push(1 - (i / heightSegments));

            // 頂点カラー (外周面のカラー区間のみ accent、それ以外はベース金属色)
            const col = sectionColored ? accent : baseColor;
            colors.push(col.r, col.g, col.b);
        }
    }

    // Generate Indices
    for (let i = 0; i < heightSegments; i++) {
        for (let jc = 0; jc < cols; jc++) {
            if (!ring[jc].bridgeNext) continue; // 面境界(多角形の角)・継ぎ目は跨がない
            const a = i * cols + jc;
            const b = i * cols + jc + 1;
            const c = (i + 1) * cols + jc;
            const d = (i + 1) * cols + jc + 1;

            // CCW Winding
            indices.push(a, d, b);
            indices.push(a, c, d);
        }
    }

    // Build Geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
};
