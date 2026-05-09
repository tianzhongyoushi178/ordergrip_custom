/**
 * バレル形状を AutoCAD 互換の DXF として書き出す。
 *
 * 出力エンティティ:
 *  - LINE          : 中心軸 / 端面 / 寸法線 / カット位置マーカー / 寸法引出線 / 外形輪郭
 *  - TEXT          : 寸法ラベル / カット種別ラベル / 素材名
 *
 * レイヤー:
 *  - OUTLINE   (白): 上下対称の輪郭
 *  - HOLES     (シアン): 前穴 / 後穴 (2BA)
 *  - CENTER    (赤): 中心軸
 *  - DIM       (黄): 全長 / 最大径 / 素材ラベル
 *  - CUT_LABEL (緑): カット位置注釈
 *
 * 座標系: AutoCAD 標準 (X 右, Y 上)。中心軸 = X 軸 (Y=0)。
 *         X=0 が左端 (チップ側), X=length が右端 (シャフト側)。
 *
 * 輪郭の生成方針:
 *  - generator.ts の同じプロファイル関数 (3D モデルと共有) を使用し、忠実に再現
 *  - 連続する共線な点は単一 LINE にまとめる (同じ傾きの線分を 1 本に統合)
 *  - その結果、平坦な land は LINE 1 本、矩形カットの直線部分は最小数の LINE で表現
 *  - カットがどこに配置されていても (タングテーパー領域含む) 正しく反映される
 */

import { DxfWriter, Colors, point3d, Units } from '@tarikjabiri/dxf';
import type { BarrelState } from '@/lib/store/useBarrelStore';
import { generateProfile } from '@/lib/math/generator';

const HOLE_RADIUS = 2.1;
const EPSILON = 1e-6;
/** 共線判定の閾値: 外積の絶対値がこれ未満なら同一直線とみなす */
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

interface Pt2D {
    z: number;
    r: number;
}

/**
 * 隣接する共線点を統合して単純化した頂点列を返す。
 * 例: [(0,0), (1,0), (2,0), (3,0)] → [(0,0), (3,0)] (中間 2 点は同一直線上のため除去)
 */
const simplifyCollinear = (points: ReadonlyArray<Pt2D>): Pt2D[] => {
    if (points.length <= 2) return [...points];
    const out: Pt2D[] = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        const a = out[out.length - 1];
        const b = points[i];
        const c = points[i + 1];
        // a → b と a → c の外積。0 なら a, b, c は共線
        const dz1 = b.z - a.z;
        const dr1 = b.r - a.r;
        const dz2 = c.z - a.z;
        const dr2 = c.r - a.r;
        const cross = dz1 * dr2 - dr1 * dz2;
        if (Math.abs(cross) > COLLINEAR_TOLERANCE) {
            // 共線でない → b を頂点として保持
            out.push(b);
        }
        // 共線なら b は不要 (a → c のラインに吸収)
    }
    out.push(points[points.length - 1]);
    return out;
};

export const generateDxf = (input: DxfBarrelInput): string => {
    const profile = generateProfile(
        input.length,
        input.maxDiameter,
        input.cuts,
        input.frontTaperLength,
        input.rearTaperLength,
        input.outline,
        input.frontEndShape,
        input.rearEndShape,
    );

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

    // profile points: { x: r, y: z } → (z, r) ペアに変換
    const outlinePts: Pt2D[] = profile.map((p) => ({ z: p.y, r: p.x }));

    // ============================================================
    // 1. 中心軸 (LINE)
    // ============================================================
    dxf.addLine(
        point3d(-2, 0, 0),
        point3d(length + 2, 0, 0),
        { layerName: 'CENTER' },
    );

    // ============================================================
    // 2. 外形輪郭 (上下対称, 全て LINE エンティティで構成)
    //    プロファイルから共線な点をマージし、最小数の LINE で再現
    // ============================================================
    const simplified = simplifyCollinear(outlinePts);

    const emitOutline = (sign: 1 | -1) => {
        for (let i = 0; i < simplified.length - 1; i++) {
            const a = simplified[i];
            const b = simplified[i + 1];
            // 退化した線分 (同一点) は出力しない
            if (Math.abs(a.z - b.z) < EPSILON && Math.abs(a.r - b.r) < EPSILON) continue;
            dxf.addLine(
                point3d(a.z, sign * a.r, 0),
                point3d(b.z, sign * b.r, 0),
                { layerName: 'OUTLINE' },
            );
        }
    };
    emitOutline(1);   // 上半 (Y > 0)
    emitOutline(-1);  // 下半 (Y < 0)

    // 端面 (LINE) — 輪郭を閉じる
    const tipR = simplified[0].r;
    const threadR = simplified[simplified.length - 1].r;
    if (tipR > EPSILON) {
        dxf.addLine(point3d(0, tipR, 0), point3d(0, -tipR, 0), { layerName: 'OUTLINE' });
    }
    if (threadR > EPSILON) {
        dxf.addLine(point3d(length, threadR, 0), point3d(length, -threadR, 0), { layerName: 'OUTLINE' });
    }

    // ============================================================
    // 3. 穴 (LINE 4 本ずつで矩形を構成)
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
    dxf.addText(
        point3d(length / 2 - 4, dimY - 3, 0),
        2,
        `L=${length.toFixed(1)}mm`,
        { layerName: 'DIM' },
    );

    dxf.addText(
        point3d(length / 2 - 6, baseR + 1.5, 0),
        2,
        `DIA ${input.maxDiameter.toFixed(1)}mm`,
        { layerName: 'DIM' },
    );

    dxf.addText(
        point3d(0, dimY - 6, 0),
        2,
        materialName(input.materialDensity),
        { layerName: 'DIM' },
    );

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
 * Web Share Files 非対応環境では false を返す。呼び出し側はフォールバック処理を実装する。
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
