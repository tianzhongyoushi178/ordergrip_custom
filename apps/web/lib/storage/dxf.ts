/**
 * バレル形状を AutoCAD 互換の DXF として書き出す。
 *
 * 出力エンティティ (OUTLINE レイヤー):
 *  - LWPOLYLINE (上半輪郭): 0→length にかけて連続した 2D ポリライン。
 *    - 矩形カット (ring/double/triple/micro): bulge=0 の頂点列で完全な直角を表現
 *    - 曲線カット (ring_r/scallop): bulge 値で円弧 (CAD で ARC として認識される)
 *  - LWPOLYLINE (下半輪郭): 上半をミラーした 2D ポリライン
 *  - LINE (端面前): (0, tipR) ↔ (0, -tipR) で輪郭を閉じる
 *  - LINE (端面後): (length, threadR) ↔ (length, -threadR) で輪郭を閉じる
 *
 * その他レイヤー:
 *  - HOLES     (シアン): 前穴 / 後穴 (2BA)
 *  - CENTER    (赤): 中心軸
 *  - DIM       (黄): 全長 / 最大径 / 素材ラベル
 *  - CUT_LABEL (緑): カット位置注釈
 *
 * 座標系: AutoCAD 標準 (X 右, Y 上)。中心軸 = X 軸 (Y=0)。
 */

import { DxfWriter, Colors, point2d, point3d, Units, LWPolylineFlags } from '@tarikjabiri/dxf';
import type { BarrelState, CutZone } from '@/lib/store/useBarrelStore';
import { generateProfile } from '@/lib/math/generator';

const HOLE_RADIUS = 2.1;
const EPSILON = 1e-6;
const COLLINEAR_TOLERANCE = 1e-6;

/** ORDER GRIP 公式 LINE アカウントの友だち追加 URL */
export const OFFICIAL_LINE_URL = 'https://lin.ee/wdJWNNK';

interface DxfBarrelInput {
    length: number;
    maxDiameter: number;
    cuts: BarrelState['cuts'];
    frontTaperLength: number;
    rearTaperLength: number;
    holeDepthFront: number;
    holeDepthRear: number;
    outline: BarrelState['outline'];
    frontEndShape: BarrelState['frontEndShape'];
    rearEndShape: BarrelState['rearEndShape'];
    materialDensity: number;
}

const materialName = (density: number): string => {
    switch (density) {
        case 18.0: return 'Tungsten 95% (18.0 g/cm3)';
        case 17.0: return 'Tungsten 90% (17.0 g/cm3)';
        case 15.0: return 'Tungsten 80% (15.0 g/cm3)';
        case 13.5: return 'Tungsten 70% (13.5 g/cm3)';
        default: return `Density ${density.toFixed(1)} g/cm3`;
    }
};

interface Vertex {
    z: number;
    r: number;
    /**
     * このフィールドが 0 以外なら、次の頂点までのセグメントは円弧として扱われる。
     * bulge = tan(円弧の中心角 / 4)。正値=CCW、負値=CW (LWPolyline 仕様)。
     */
    bulge: number;
}

const getActiveWidth = (cut: CutZone, pitch: number): number => {
    const aw = cut.properties.cutWidth;
    if (aw !== undefined && aw < pitch) return aw;
    return pitch;
};

/** 共線統合: 連続する共線な点を除去 (最初/最後は保持) */
const simplifyCollinear = (verts: Vertex[]): Vertex[] => {
    if (verts.length <= 2) return [...verts];
    const out: Vertex[] = [verts[0]];
    for (let i = 1; i < verts.length - 1; i++) {
        const a = out[out.length - 1];
        const b = verts[i];
        const c = verts[i + 1];
        // bulge が非ゼロなら円弧なので除去しない
        if (Math.abs(a.bulge) > EPSILON || Math.abs(b.bulge) > EPSILON) {
            out.push(b);
            continue;
        }
        const dz1 = b.z - a.z;
        const dr1 = b.r - a.r;
        const dz2 = c.z - a.z;
        const dr2 = c.r - a.r;
        const cross = dz1 * dr2 - dr1 * dz2;
        if (Math.abs(cross) > COLLINEAR_TOLERANCE) {
            out.push(b);
        }
    }
    out.push(verts[verts.length - 1]);
    return out;
};

/** 重複頂点 (連続して同じ z, r) を除去 */
const dedupVertices = (verts: Vertex[]): Vertex[] => {
    const out: Vertex[] = [];
    for (const v of verts) {
        const last = out[out.length - 1];
        if (!last || Math.abs(last.z - v.z) > EPSILON || Math.abs(last.r - v.r) > EPSILON) {
            out.push(v);
        } else {
            // 同じ点なら bulge を引き継ぐ (新しい方を優先)
            if (Math.abs(v.bulge) > EPSILON) last.bulge = v.bulge;
        }
    }
    return out;
};

export const generateDxf = (input: DxfBarrelInput): string => {
    // baseProfile: カット無しのプロファイル (テーパー・カスタム輪郭は反映)
    const baseProfile = generateProfile(
        input.length,
        input.maxDiameter,
        [],
        input.frontTaperLength,
        input.rearTaperLength,
        input.outline,
        input.frontEndShape,
        input.rearEndShape,
    );
    const basePts = baseProfile.map((p) => ({ z: p.y, r: p.x }));

    const baseRAt = (z: number): number => {
        if (basePts.length === 0) return input.maxDiameter / 2;
        if (z <= basePts[0].z) return basePts[0].r;
        if (z >= basePts[basePts.length - 1].z) return basePts[basePts.length - 1].r;
        let lo = 0, hi = basePts.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (basePts[mid].z <= z) lo = mid; else hi = mid;
        }
        const a = basePts[lo], b = basePts[hi];
        if (b.z - a.z < EPSILON) return a.r;
        const t = (z - a.z) / (b.z - a.z);
        return a.r + (b.r - a.r) * t;
    };

    const dxf = new DxfWriter();
    dxf.setUnits(Units.Millimeters);

    dxf.addLayer('OUTLINE', Colors.White, 'Continuous');
    dxf.addLayer('HOLES', Colors.Cyan, 'Continuous');
    dxf.addLayer('CENTER', Colors.Red, 'Continuous');
    dxf.addLayer('DIM', Colors.Yellow, 'Continuous');
    dxf.addLayer('CUT_LABEL', Colors.Green, 'Continuous');

    const baseR = input.maxDiameter / 2;
    const length = input.length;

    // ============================================================
    // 1. 中心軸 (LINE)
    // ============================================================
    dxf.addLine(
        point3d(-2, 0, 0),
        point3d(length + 2, 0, 0),
        { layerName: 'CENTER' },
    );

    // ============================================================
    // 2. 上半輪郭の頂点列を構築
    // ============================================================
    const sortedCuts = input.cuts
        .filter((c) => c.type !== 'vertical' && c.startZ < c.endZ)
        .slice()
        .sort((a, b) => a.startZ - b.startZ);

    /** baseProfile の [zStart, zEnd] 区間の頂点を取得 (共線統合済み) */
    const getBaseVertices = (zStart: number, zEnd: number): Vertex[] => {
        if (zEnd - zStart < EPSILON) return [{ z: zStart, r: baseRAt(zStart), bulge: 0 }];
        const inRange = basePts.filter((p) => p.z > zStart + EPSILON && p.z < zEnd - EPSILON);
        const verts: Vertex[] = [
            { z: zStart, r: baseRAt(zStart), bulge: 0 },
            ...inRange.map((p) => ({ z: p.z, r: p.r, bulge: 0 })),
            { z: zEnd, r: baseRAt(zEnd), bulge: 0 },
        ];
        return simplifyCollinear(verts);
    };

    /** カット 1 周期分の頂点列 (上半側、bulge は top arc 用) */
    const getCutPeriodVertices = (cut: CutZone, cycleStart: number): Vertex[] => {
        const pitch = cut.properties.pitch ?? 1.0;
        const depth = cut.properties.depth ?? 0.5;
        const peakR = baseRAt(cycleStart);
        const valleyR = peakR - depth;

        switch (cut.type) {
            case 'ring':
            case 'micro': {
                const cw = Math.min(cut.properties.cutWidth ?? pitch * 0.5, pitch * 0.95);
                const verts: Vertex[] = [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart, r: valleyR, bulge: 0 },
                    { z: cycleStart + cw, r: valleyR, bulge: 0 },
                    { z: cycleStart + cw, r: peakR, bulge: 0 },
                ];
                if (pitch - cw > EPSILON) {
                    verts.push({ z: cycleStart + pitch, r: peakR, bulge: 0 });
                }
                return verts;
            }
            case 'ring_double': {
                const cw = cut.properties.cutWidth ?? pitch * 0.2;
                const gw = cut.properties.gapWidth ?? pitch * 0.15;
                const verts: Vertex[] = [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart, r: valleyR, bulge: 0 },
                    { z: cycleStart + cw, r: valleyR, bulge: 0 },
                    { z: cycleStart + cw, r: peakR, bulge: 0 },
                    { z: cycleStart + cw + gw, r: peakR, bulge: 0 },
                    { z: cycleStart + cw + gw, r: valleyR, bulge: 0 },
                    { z: cycleStart + 2 * cw + gw, r: valleyR, bulge: 0 },
                    { z: cycleStart + 2 * cw + gw, r: peakR, bulge: 0 },
                ];
                if (pitch - 2 * cw - gw > EPSILON) {
                    verts.push({ z: cycleStart + pitch, r: peakR, bulge: 0 });
                }
                return verts;
            }
            case 'ring_triple': {
                const cw = cut.properties.cutWidth ?? pitch * 0.15;
                const gw = cut.properties.gapWidth ?? pitch * 0.1;
                const verts: Vertex[] = [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart, r: valleyR, bulge: 0 },
                    { z: cycleStart + cw, r: valleyR, bulge: 0 },
                    { z: cycleStart + cw, r: peakR, bulge: 0 },
                    { z: cycleStart + cw + gw, r: peakR, bulge: 0 },
                    { z: cycleStart + cw + gw, r: valleyR, bulge: 0 },
                    { z: cycleStart + 2 * cw + gw, r: valleyR, bulge: 0 },
                    { z: cycleStart + 2 * cw + gw, r: peakR, bulge: 0 },
                    { z: cycleStart + 2 * cw + 2 * gw, r: peakR, bulge: 0 },
                    { z: cycleStart + 2 * cw + 2 * gw, r: valleyR, bulge: 0 },
                    { z: cycleStart + 3 * cw + 2 * gw, r: valleyR, bulge: 0 },
                    { z: cycleStart + 3 * cw + 2 * gw, r: peakR, bulge: 0 },
                ];
                if (pitch - 3 * cw - 2 * gw > EPSILON) {
                    verts.push({ z: cycleStart + pitch, r: peakR, bulge: 0 });
                }
                return verts;
            }
            case 'ring_r':
            case 'scallop': {
                // 円弧: (z0, peakR) → (z0+aw, peakR), 中央で valleyR
                // 円弧の中心角 = π - 2θ, θ = atan2(R-depth, aw/2), R = (aw² + 4*depth²)/(8*depth)
                // bulge = tan(中心角 / 4)
                const aw = getActiveWidth(cut, pitch);
                const R = (aw * aw + 4 * depth * depth) / (8 * depth);
                const theta = Math.atan2(R - depth, aw / 2);
                const includedAngle = Math.PI - 2 * theta;
                const bulge = Math.tan(includedAngle / 4); // 上半 valley 円弧は CCW (正)
                const verts: Vertex[] = [
                    { z: cycleStart, r: peakR, bulge },         // 円弧開始
                    { z: cycleStart + aw, r: peakR, bulge: 0 }, // 円弧終了
                ];
                if (pitch - aw > EPSILON) {
                    verts.push({ z: cycleStart + pitch, r: peakR, bulge: 0 });
                }
                return verts;
            }
            case 'ring_v': {
                const aw = getActiveWidth(cut, pitch);
                return [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart + aw / 2, r: valleyR, bulge: 0 },
                    { z: cycleStart + aw, r: peakR, bulge: 0 },
                    ...(pitch - aw > EPSILON ? [{ z: cycleStart + pitch, r: peakR, bulge: 0 }] : []),
                ];
            }
            case 'canyon': {
                const aw = getActiveWidth(cut, pitch);
                return [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart + 0.2 * aw, r: valleyR, bulge: 0 },
                    { z: cycleStart + 0.8 * aw, r: valleyR, bulge: 0 },
                    { z: cycleStart + aw, r: peakR, bulge: 0 },
                    ...(pitch - aw > EPSILON ? [{ z: cycleStart + pitch, r: peakR, bulge: 0 }] : []),
                ];
            }
            case 'shark': {
                const aw = getActiveWidth(cut, pitch);
                return [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart, r: valleyR, bulge: 0 },
                    { z: cycleStart + aw, r: peakR, bulge: 0 },
                    ...(pitch - aw > EPSILON ? [{ z: cycleStart + pitch, r: peakR, bulge: 0 }] : []),
                ];
            }
            case 'wing': {
                const aw = getActiveWidth(cut, pitch);
                const verts: Vertex[] = [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart, r: valleyR, bulge: 0 },
                ];
                const segments = 16;
                for (let i = 1; i <= segments; i++) {
                    const f = i / segments;
                    const rOff = depth * (1 - Math.pow(f, 0.6));
                    verts.push({ z: cycleStart + f * aw, r: peakR - rOff, bulge: 0 });
                }
                if (pitch - aw > EPSILON) {
                    verts.push({ z: cycleStart + pitch, r: peakR, bulge: 0 });
                }
                return verts;
            }
            case 'step': {
                const aw = getActiveWidth(cut, pitch);
                const midR = peakR - depth * 0.5;
                return [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart + 0.3 * aw, r: peakR, bulge: 0 },
                    { z: cycleStart + 0.3 * aw, r: midR, bulge: 0 },
                    { z: cycleStart + 0.6 * aw, r: midR, bulge: 0 },
                    { z: cycleStart + 0.6 * aw, r: valleyR, bulge: 0 },
                    { z: cycleStart + aw, r: valleyR, bulge: 0 },
                    { z: cycleStart + aw, r: peakR, bulge: 0 },
                    ...(pitch - aw > EPSILON ? [{ z: cycleStart + pitch, r: peakR, bulge: 0 }] : []),
                ];
            }
            case 'stair': {
                const aw = getActiveWidth(cut, pitch);
                return [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart + 0.2 * aw, r: valleyR, bulge: 0 },
                    { z: cycleStart + 0.5 * aw, r: valleyR, bulge: 0 },
                    { z: cycleStart + 0.7 * aw, r: peakR, bulge: 0 },
                    ...(pitch - aw > EPSILON ? [{ z: cycleStart + pitch, r: peakR, bulge: 0 }] : []),
                ];
            }
            default:
                return [
                    { z: cycleStart, r: peakR, bulge: 0 },
                    { z: cycleStart + pitch, r: peakR, bulge: 0 },
                ];
        }
    };

    // 上半輪郭を構築
    let topVerts: Vertex[] = [];
    let cursor = 0;
    for (const cut of sortedCuts) {
        if (cut.startZ < cursor - EPSILON) continue;
        const baseSeg = getBaseVertices(cursor, cut.startZ);
        topVerts.push(...baseSeg);

        const pitch = cut.properties.pitch ?? 1.0;
        const count = Math.max(0, Math.round((cut.endZ - cut.startZ) / pitch));
        for (let i = 0; i < count; i++) {
            const cycleStart = cut.startZ + i * pitch;
            topVerts.push(...getCutPeriodVertices(cut, cycleStart));
        }
        cursor = cut.startZ + count * pitch;
    }
    topVerts.push(...getBaseVertices(cursor, length));
    topVerts = dedupVertices(topVerts);

    // ============================================================
    // 3. 上半輪郭を LWPolyline として出力
    // ============================================================
    if (topVerts.length >= 2) {
        dxf.addLWPolyline(
            topVerts.map((v) => ({ point: point2d(v.z, v.r), bulge: v.bulge })),
            { layerName: 'OUTLINE', flags: LWPolylineFlags.None },
        );
    }

    // ============================================================
    // 4. 下半輪郭 = 上半輪郭をミラー (r 反転、頂点逆順、bulge 符号反転)
    // ============================================================
    const bottomVerts: Vertex[] = [];
    for (let i = topVerts.length - 1; i >= 0; i--) {
        const v = topVerts[i];
        // bulge は次の頂点に対して定義されるので、逆順時は前の頂点の bulge を反転して使う
        // 上半: vert[i].bulge は vert[i] → vert[i+1] の弧
        // 下半 (逆順): bottom[i'] → bottom[i'+1] (i' = N-1-i) は top[i] ← top[i-1] に対応
        // bottom[i'].bulge = -top[i-1].bulge (または top[i].bulge を使う場合は注意)
        //
        // 実装: 単純化のため、逆順で bulge を「前の要素」から取る
        const prevBulge = i > 0 ? topVerts[i - 1].bulge : 0;
        bottomVerts.push({ z: v.z, r: -v.r, bulge: -prevBulge });
    }
    if (bottomVerts.length >= 2) {
        dxf.addLWPolyline(
            bottomVerts.map((v) => ({ point: point2d(v.z, v.r), bulge: v.bulge })),
            { layerName: 'OUTLINE', flags: LWPolylineFlags.None },
        );
    }

    // ============================================================
    // 5. 端面 (LINE) — 輪郭を閉じる
    // ============================================================
    const tipR = baseRAt(0);
    const threadR = baseRAt(length);
    if (tipR > EPSILON) {
        dxf.addLine(point3d(0, tipR, 0), point3d(0, -tipR, 0), { layerName: 'OUTLINE' });
    }
    if (threadR > EPSILON) {
        dxf.addLine(point3d(length, threadR, 0), point3d(length, -threadR, 0), { layerName: 'OUTLINE' });
    }

    // ============================================================
    // 6. 穴 (LWPolyline 矩形) — それぞれ閉じた 1 つのポリライン
    // ============================================================
    if (input.holeDepthFront > 0) {
        const fh = input.holeDepthFront;
        dxf.addLWPolyline(
            [
                { point: point2d(0, HOLE_RADIUS) },
                { point: point2d(fh, HOLE_RADIUS) },
                { point: point2d(fh, -HOLE_RADIUS) },
                { point: point2d(0, -HOLE_RADIUS) },
            ],
            { layerName: 'HOLES', flags: LWPolylineFlags.Closed },
        );
    }
    if (input.holeDepthRear > 0) {
        const start = length - input.holeDepthRear;
        dxf.addLWPolyline(
            [
                { point: point2d(start, HOLE_RADIUS) },
                { point: point2d(length, HOLE_RADIUS) },
                { point: point2d(length, -HOLE_RADIUS) },
                { point: point2d(start, -HOLE_RADIUS) },
            ],
            { layerName: 'HOLES', flags: LWPolylineFlags.Closed },
        );
    }

    // ============================================================
    // 7. カット位置マーカー (LINE + TEXT)
    // ============================================================
    const labelOffset = baseR + 4;
    for (const cut of input.cuts) {
        if (cut.type === 'vertical') continue;
        dxf.addLine(point3d(cut.startZ, baseR + 1, 0), point3d(cut.startZ, labelOffset, 0), { layerName: 'CUT_LABEL' });
        dxf.addLine(point3d(cut.endZ, baseR + 1, 0), point3d(cut.endZ, labelOffset, 0), { layerName: 'CUT_LABEL' });
        dxf.addLine(point3d(cut.startZ, labelOffset, 0), point3d(cut.endZ, labelOffset, 0), { layerName: 'CUT_LABEL' });
        const midZ = (cut.startZ + cut.endZ) / 2;
        dxf.addText(point3d(midZ - 5, labelOffset + 0.5, 0), 1.5, cut.type, { layerName: 'CUT_LABEL' });
    }

    // ============================================================
    // 8. 寸法 (LINE + TEXT)
    // ============================================================
    const dimY = -baseR - 5;
    dxf.addLine(point3d(0, dimY, 0), point3d(length, dimY, 0), { layerName: 'DIM' });
    dxf.addLine(point3d(0, dimY - 1, 0), point3d(0, dimY + 1, 0), { layerName: 'DIM' });
    dxf.addLine(point3d(length, dimY - 1, 0), point3d(length, dimY + 1, 0), { layerName: 'DIM' });
    dxf.addText(point3d(length / 2 - 4, dimY - 3, 0), 2, `L=${length.toFixed(1)}mm`, { layerName: 'DIM' });
    dxf.addText(point3d(length / 2 - 6, baseR + 1.5, 0), 2, `DIA ${input.maxDiameter.toFixed(1)}mm`, { layerName: 'DIM' });
    dxf.addText(point3d(0, dimY - 6, 0), 2, materialName(input.materialDensity), { layerName: 'DIM' });

    return dxf.stringify();
};

const buildFilename = (): string => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `barrel-${yyyy}${mm}${dd}-${hh}${mi}.dxf`;
};

export const exportToDxf = (input: DxfBarrelInput, filename?: string): void => {
    const dxf = generateDxf(input);
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? buildFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

export const shareDxf = async (input: DxfBarrelInput, filename?: string): Promise<boolean> => {
    const dxf = generateDxf(input);
    const name = filename ?? buildFilename();
    const file = new File([dxf], name, { type: 'application/dxf' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
    if (!nav.canShare({ files: [file] })) return false;
    try {
        await nav.share({
            files: [file],
            title: 'バレル設計データ',
            text: 'ORDER GRIP で作成したバレル設計図 (DXF) です。',
        });
        return true;
    } catch (err) {
        if ((err as Error).name === 'AbortError') return true;
        return false;
    }
};
