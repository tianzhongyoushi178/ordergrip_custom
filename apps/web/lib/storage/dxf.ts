/**
 * バレル形状を AutoCAD 互換の DXF として書き出す。
 *
 * 出力エンティティ:
 *  - LINE  : 中心軸 / 端面 / 寸法線 / 外形輪郭の直線部分 / 矩形カットの壁・底
 *  - ARC   : Rリング・スカラップカットの曲線部分 (円弧)
 *  - TEXT  : 寸法ラベル / カット種別ラベル / 素材名
 *
 * レイヤー:
 *  - OUTLINE   (白): 上下対称の輪郭
 *  - HOLES     (シアン): 前穴 / 後穴 (2BA)
 *  - CENTER    (赤): 中心軸
 *  - DIM       (黄): 全長 / 最大径 / 素材ラベル
 *  - CUT_LABEL (緑): カット位置注釈
 *
 * 座標系: AutoCAD 標準 (X 右, Y 上)。中心軸 = X 軸 (Y=0)。
 *
 * 輪郭の生成方針:
 *  1. baseProfile = カット無しのプロファイル (テーパー・本体のベース形状)
 *  2. 各カット領域では、カット種類に応じた厳密なプリミティブを発行:
 *     - 矩形系 (ring/micro/ring_double/ring_triple): 真の直角を持つ 4 LINE 矩形
 *     - 曲線系 (ring_r/scallop): ARC エンティティ (1 周期=1 円弧)
 *     - 角度系 (ring_v/canyon/shark/wing/step/stair): 形状に応じた LINE 群
 *  3. カット無しの z 範囲では baseProfile を共線統合した LINE で出力
 *  4. 上下対称: 同じ処理を Y 反転で再実行
 */

import { DxfWriter, Colors, point3d, Units } from '@tarikjabiri/dxf';
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

interface Pt2D { z: number; r: number }

const simplifyCollinear = (points: ReadonlyArray<Pt2D>): Pt2D[] => {
    if (points.length <= 2) return [...points];
    const out: Pt2D[] = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        const a = out[out.length - 1];
        const b = points[i];
        const c = points[i + 1];
        const dz1 = b.z - a.z;
        const dr1 = b.r - a.r;
        const dz2 = c.z - a.z;
        const dr2 = c.r - a.r;
        const cross = dz1 * dr2 - dr1 * dz2;
        if (Math.abs(cross) > COLLINEAR_TOLERANCE) {
            out.push(b);
        }
    }
    out.push(points[points.length - 1]);
    return out;
};

/** 非 groove 系カットの実効幅 (cutWidth が pitch 未満なら短縮、それ以外は pitch 全幅) */
const getActiveWidth = (cut: CutZone, pitch: number): number => {
    const aw = cut.properties.cutWidth;
    if (aw !== undefined && aw < pitch) return aw;
    return pitch;
};

export const generateDxf = (input: DxfBarrelInput): string => {
    // baseProfile: カット無しのプロファイル (テーパー・カスタム輪郭は反映)
    const baseProfile = generateProfile(
        input.length,
        input.maxDiameter,
        [], // cuts なし
        input.frontTaperLength,
        input.rearTaperLength,
        input.outline,
        input.frontEndShape,
        input.rearEndShape,
    );
    const basePts: Pt2D[] = baseProfile.map((p) => ({ z: p.y, r: p.x }));

    /** baseProfile での z における半径 (線形補間) */
    const baseRAt = (z: number): number => {
        if (basePts.length === 0) return input.maxDiameter / 2;
        if (z <= basePts[0].z) return basePts[0].r;
        if (z >= basePts[basePts.length - 1].z) return basePts[basePts.length - 1].r;
        // 二分探索
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

    // レイヤー定義
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
    // 2. 外形輪郭
    // ============================================================
    const emitLineBoth = (z1: number, r1: number, z2: number, r2: number) => {
        if (Math.abs(z1 - z2) < EPSILON && Math.abs(r1 - r2) < EPSILON) return;
        dxf.addLine(point3d(z1, r1, 0), point3d(z2, r2, 0), { layerName: 'OUTLINE' });
        dxf.addLine(point3d(z1, -r1, 0), point3d(z2, -r2, 0), { layerName: 'OUTLINE' });
    };

    /** baseProfile の [zStart, zEnd] 区間を共線統合 LINE で上下に出力 */
    const emitBaseSegment = (zStart: number, zEnd: number) => {
        if (zEnd - zStart < EPSILON) return;
        const inRange = basePts.filter((p) => p.z >= zStart - EPSILON && p.z <= zEnd + EPSILON);
        const points: Pt2D[] = [{ z: zStart, r: baseRAt(zStart) }, ...inRange, { z: zEnd, r: baseRAt(zEnd) }];
        // 重複点除去
        const dedup: Pt2D[] = [];
        for (const p of points) {
            const last = dedup[dedup.length - 1];
            if (!last || Math.abs(last.z - p.z) > EPSILON) dedup.push(p);
        }
        const simplified = simplifyCollinear(dedup);
        for (let i = 0; i < simplified.length - 1; i++) {
            emitLineBoth(simplified[i].z, simplified[i].r, simplified[i + 1].z, simplified[i + 1].r);
        }
    };

    /** 矩形溝 (4 直線で上下) を emit */
    const emitRectGroove = (z0: number, cutWidth: number, totalLen: number, peakR: number, depth: number) => {
        const valleyR = peakR - depth;
        const cw = Math.min(cutWidth, totalLen - EPSILON);
        // 上半: 左壁→底→右壁→ (land)
        dxf.addLine(point3d(z0, peakR, 0), point3d(z0, valleyR, 0), { layerName: 'OUTLINE' });
        dxf.addLine(point3d(z0, valleyR, 0), point3d(z0 + cw, valleyR, 0), { layerName: 'OUTLINE' });
        dxf.addLine(point3d(z0 + cw, valleyR, 0), point3d(z0 + cw, peakR, 0), { layerName: 'OUTLINE' });
        if (totalLen - cw > EPSILON) {
            dxf.addLine(point3d(z0 + cw, peakR, 0), point3d(z0 + totalLen, peakR, 0), { layerName: 'OUTLINE' });
        }
        // 下半 (mirror)
        dxf.addLine(point3d(z0, -peakR, 0), point3d(z0, -valleyR, 0), { layerName: 'OUTLINE' });
        dxf.addLine(point3d(z0, -valleyR, 0), point3d(z0 + cw, -valleyR, 0), { layerName: 'OUTLINE' });
        dxf.addLine(point3d(z0 + cw, -valleyR, 0), point3d(z0 + cw, -peakR, 0), { layerName: 'OUTLINE' });
        if (totalLen - cw > EPSILON) {
            dxf.addLine(point3d(z0 + cw, -peakR, 0), point3d(z0 + totalLen, -peakR, 0), { layerName: 'OUTLINE' });
        }
    };

    /** Rリング・スカラップ用: 半サイン波形を ARC エンティティで近似 */
    const emitArcGroove = (z0: number, aw: number, pitch: number, peakR: number, depth: number) => {
        if (depth < EPSILON || aw < EPSILON) return;
        // (z0, peakR), (z0+aw/2, peakR-depth), (z0+aw, peakR) を通る円弧
        const R = (aw * aw + 4 * depth * depth) / (8 * depth);
        // theta: チョード端からの中心へのベクトル角度 (degrees)
        const theta = Math.atan2(R - depth, aw / 2) * 180 / Math.PI;

        // 上半: 中心 (z0+aw/2, peakR - depth + R), arc は 180+θ → 360-θ (CCW, 270°経由で valley を通る)
        const topCy = peakR - depth + R;
        dxf.addArc(
            point3d(z0 + aw / 2, topCy, 0),
            R,
            180 + theta,
            360 - theta,
            { layerName: 'OUTLINE' },
        );

        // 下半: 中心 (z0+aw/2, -topCy), arc は θ → 180-θ (CCW, 90°経由)
        dxf.addArc(
            point3d(z0 + aw / 2, -topCy, 0),
            R,
            theta,
            180 - theta,
            { layerName: 'OUTLINE' },
        );

        // land (アクティブ幅が pitch 未満の場合)
        if (pitch - aw > EPSILON) {
            emitLineBoth(z0 + aw, peakR, z0 + pitch, peakR);
        }
    };

    /** 頂点列を LINE で連結 (上下対称). 隣接頂点のペアを LINE 化 */
    const emitVertexPath = (verts: Pt2D[]) => {
        for (let i = 0; i < verts.length - 1; i++) {
            const a = verts[i], b = verts[i + 1];
            emitLineBoth(a.z, a.r, b.z, b.r);
        }
    };

    /** 1 周期分のカット形状を emit */
    const emitCutPeriod = (cut: CutZone, cycleStart: number) => {
        const pitch = cut.properties.pitch ?? 1.0;
        const depth = cut.properties.depth ?? 0.5;
        const peakR = baseRAt(cycleStart);

        switch (cut.type) {
            case 'ring':
            case 'micro': {
                const cw = Math.min(cut.properties.cutWidth ?? pitch * 0.5, pitch * 0.95);
                emitRectGroove(cycleStart, cw, pitch, peakR, depth);
                break;
            }
            case 'ring_double': {
                const cw = cut.properties.cutWidth ?? pitch * 0.2;
                const gw = cut.properties.gapWidth ?? pitch * 0.15;
                // 1 つ目の溝 + gap (2 つ目までの land)
                emitRectGroove(cycleStart, cw, cw + gw, peakR, depth);
                // 2 つ目の溝 + 残り land
                emitRectGroove(cycleStart + cw + gw, cw, pitch - cw - gw, peakR, depth);
                break;
            }
            case 'ring_triple': {
                const cw = cut.properties.cutWidth ?? pitch * 0.15;
                const gw = cut.properties.gapWidth ?? pitch * 0.1;
                emitRectGroove(cycleStart, cw, cw + gw, peakR, depth);
                emitRectGroove(cycleStart + cw + gw, cw, cw + gw, peakR, depth);
                emitRectGroove(cycleStart + 2 * (cw + gw), cw, pitch - 2 * (cw + gw), peakR, depth);
                break;
            }
            case 'ring_r':
            case 'scallop': {
                const aw = getActiveWidth(cut, pitch);
                emitArcGroove(cycleStart, aw, pitch, peakR, depth);
                break;
            }
            case 'ring_v': {
                const aw = getActiveWidth(cut, pitch);
                emitVertexPath([
                    { z: cycleStart, r: peakR },
                    { z: cycleStart + aw / 2, r: peakR - depth },
                    { z: cycleStart + aw, r: peakR },
                    { z: cycleStart + pitch, r: peakR },
                ]);
                break;
            }
            case 'canyon': {
                const aw = getActiveWidth(cut, pitch);
                emitVertexPath([
                    { z: cycleStart, r: peakR },
                    { z: cycleStart + 0.2 * aw, r: peakR - depth },
                    { z: cycleStart + 0.8 * aw, r: peakR - depth },
                    { z: cycleStart + aw, r: peakR },
                    { z: cycleStart + pitch, r: peakR },
                ]);
                break;
            }
            case 'shark': {
                const aw = getActiveWidth(cut, pitch);
                emitVertexPath([
                    { z: cycleStart, r: peakR },
                    { z: cycleStart, r: peakR - depth }, // 急下降
                    { z: cycleStart + aw, r: peakR },     // ramp up
                    { z: cycleStart + pitch, r: peakR },  // land
                ]);
                break;
            }
            case 'wing': {
                const aw = getActiveWidth(cut, pitch);
                const points: Pt2D[] = [
                    { z: cycleStart, r: peakR },
                    { z: cycleStart, r: peakR - depth },
                ];
                const segments = 16;
                for (let i = 1; i <= segments; i++) {
                    const f = i / segments;
                    const rOff = depth * (1 - Math.pow(f, 0.6));
                    points.push({ z: cycleStart + f * aw, r: peakR - rOff });
                }
                if (pitch - aw > EPSILON) {
                    points.push({ z: cycleStart + pitch, r: peakR });
                }
                emitVertexPath(points);
                break;
            }
            case 'step': {
                const aw = getActiveWidth(cut, pitch);
                const midR = peakR - depth * 0.5;
                emitVertexPath([
                    { z: cycleStart, r: peakR },
                    { z: cycleStart + 0.3 * aw, r: peakR },
                    { z: cycleStart + 0.3 * aw, r: midR },
                    { z: cycleStart + 0.6 * aw, r: midR },
                    { z: cycleStart + 0.6 * aw, r: peakR - depth },
                    { z: cycleStart + aw, r: peakR - depth },
                    { z: cycleStart + aw, r: peakR },
                    { z: cycleStart + pitch, r: peakR },
                ]);
                break;
            }
            case 'stair': {
                const aw = getActiveWidth(cut, pitch);
                emitVertexPath([
                    { z: cycleStart, r: peakR },
                    { z: cycleStart + 0.2 * aw, r: peakR - depth },
                    { z: cycleStart + 0.5 * aw, r: peakR - depth },
                    { z: cycleStart + 0.7 * aw, r: peakR },
                    { z: cycleStart + pitch, r: peakR },
                ]);
                break;
            }
            default:
                emitVertexPath([
                    { z: cycleStart, r: peakR },
                    { z: cycleStart + pitch, r: peakR },
                ]);
                break;
        }
    };

    // メインループ: カット領域とカット無し領域を交互に emit
    const sortedCuts = input.cuts
        .filter((c) => c.type !== 'vertical' && c.startZ < c.endZ)
        .slice()
        .sort((a, b) => a.startZ - b.startZ);

    let cursor = 0;
    for (const cut of sortedCuts) {
        if (cut.startZ < cursor - EPSILON) continue; // 重複は無視
        // カット手前のベース区間
        emitBaseSegment(cursor, cut.startZ);

        // カット周期
        const pitch = cut.properties.pitch ?? 1.0;
        const count = Math.max(0, Math.round((cut.endZ - cut.startZ) / pitch));
        for (let i = 0; i < count; i++) {
            const cycleStart = cut.startZ + i * pitch;
            emitCutPeriod(cut, cycleStart);
        }

        cursor = cut.startZ + count * pitch;
    }
    // 末尾のベース区間
    emitBaseSegment(cursor, length);

    // 端面 (LINE) — 輪郭を閉じる
    const tipR = baseRAt(0);
    const threadR = baseRAt(length);
    if (tipR > EPSILON) {
        dxf.addLine(point3d(0, tipR, 0), point3d(0, -tipR, 0), { layerName: 'OUTLINE' });
    }
    if (threadR > EPSILON) {
        dxf.addLine(point3d(length, threadR, 0), point3d(length, -threadR, 0), { layerName: 'OUTLINE' });
    }

    // ============================================================
    // 3. 穴 (LINE 4 本ずつで矩形)
    // ============================================================
    if (input.holeDepthFront > 0) {
        const fh = input.holeDepthFront;
        dxf.addLine(point3d(0, HOLE_RADIUS, 0), point3d(fh, HOLE_RADIUS, 0), { layerName: 'HOLES' });
        dxf.addLine(point3d(fh, HOLE_RADIUS, 0), point3d(fh, -HOLE_RADIUS, 0), { layerName: 'HOLES' });
        dxf.addLine(point3d(fh, -HOLE_RADIUS, 0), point3d(0, -HOLE_RADIUS, 0), { layerName: 'HOLES' });
        dxf.addLine(point3d(0, -HOLE_RADIUS, 0), point3d(0, HOLE_RADIUS, 0), { layerName: 'HOLES' });
    }
    if (input.holeDepthRear > 0) {
        const start = length - input.holeDepthRear;
        dxf.addLine(point3d(start, HOLE_RADIUS, 0), point3d(length, HOLE_RADIUS, 0), { layerName: 'HOLES' });
        dxf.addLine(point3d(length, HOLE_RADIUS, 0), point3d(length, -HOLE_RADIUS, 0), { layerName: 'HOLES' });
        dxf.addLine(point3d(length, -HOLE_RADIUS, 0), point3d(start, -HOLE_RADIUS, 0), { layerName: 'HOLES' });
        dxf.addLine(point3d(start, -HOLE_RADIUS, 0), point3d(start, HOLE_RADIUS, 0), { layerName: 'HOLES' });
    }

    // ============================================================
    // 4. カット位置マーカー (LINE + TEXT)
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
    // 5. 寸法 (LINE + TEXT)
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

/**
 * Web Share API で DXF を共有 (LINE 等を選択できる)。
 * Web Share Files 非対応環境では false を返す。
 */
export const shareDxf = async (input: DxfBarrelInput, filename?: string): Promise<boolean> => {
    const dxf = generateDxf(input);
    const name = filename ?? buildFilename();
    const file = new File([dxf], name, { type: 'application/dxf' });

    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') {
        return false;
    }
    if (!nav.canShare({ files: [file] })) {
        return false;
    }
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
