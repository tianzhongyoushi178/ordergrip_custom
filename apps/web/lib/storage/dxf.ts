/**
 * バレル形状を AutoCAD 互換の DXF として書き出す。
 *
 * 出力エンティティ:
 *  - LINE          : 中心軸 / 端面 / 寸法線 / カット位置マーカー / 寸法引出線
 *  - ARC           : 前後端の R 形状 (frontEndShape='round' / rearEndShape='round')
 *  - LWPolyline    : 本体プロファイル (2D 軽量ポリライン), 穴 (矩形)
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
 */

import { DxfWriter, Colors, point2d, point3d, Units } from '@tarikjabiri/dxf';
import type { BarrelState } from '@/lib/store/useBarrelStore';
import { generateProfile } from '@/lib/math/generator';
import { cutPeriodVertices } from '@/lib/storage/cutShape';

const HOLE_RADIUS = 2.1;
const TIP_RADIUS = 2.9;
const THREAD_RADIUS = 2.9;
const EPSILON = 1e-6;

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

/**
 * 中心側の前面/後面端の半径。custom outline がある場合はその先頭/末尾の半径を採用、
 * なければ既定 (TIP_RADIUS / THREAD_RADIUS) を返す。
 */
const endRadii = (input: DxfBarrelInput): { tip: number; thread: number } => {
    if (input.outline.length > 1) {
        const sorted = [...input.outline].sort((a, b) => a.z - b.z);
        return {
            tip: sorted[0].d / 2,
            thread: sorted[sorted.length - 1].d / 2,
        };
    }
    return { tip: TIP_RADIUS, thread: THREAD_RADIUS };
};

/**
 * profile2D 配列 ({ x: z, y: r }) から指定の z 範囲内の点だけ抽出する。
 */
const sliceProfile = (
    profile2D: ReadonlyArray<{ x: number; y: number }>,
    zStart: number,
    zEnd: number,
): { x: number; y: number }[] => {
    // profile2D points: { x: z, y: r } (x が軸方向, y が半径)
    return profile2D
        .filter((p) => p.x >= zStart - EPSILON && p.x <= zEnd + EPSILON)
        .map((p) => ({ x: p.x, y: p.y }));
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
    const frontTaper = input.frontTaperLength;
    const rearTaperStart = length - input.rearTaperLength;
    const { tip: tipR, thread: threadR } = endRadii(input);

    // ============================================================
    // 1. 中心軸 (LINE)
    // ============================================================
    dxf.addLine(
        point3d(-2, 0, 0),
        point3d(length + 2, 0, 0),
        { layerName: 'CENTER' },
    );

    // ============================================================
    // 2. 外形輪郭の構成
    //    - 前端 / 後端: LINE (taper) または ARC (round)
    //    - 本体: カットが無ければ LINE 1本、あれば LWPolyline
    //    - 上下対称: 同じ処理を Y を反転して再実行
    //    - 端面 (前/後): LINE で輪郭を閉じる
    // ============================================================
    const useCustomOutline = input.outline.length > 1;
    const profile2D = profile.map((p) => ({ x: p.y, y: p.x })); // (z, r) に変換

    const emitFrontEnd = (sign: 1 | -1) => {
        // チップ (0, sign*tipR) → ベース (frontTaper, sign*baseR)
        if (useCustomOutline) {
            // カスタム輪郭の場合は分解できないので polyline で出力
            const seg = sliceProfile(profile2D, 0, frontTaper);
            if (seg.length >= 2) {
                dxf.addLWPolyline(
                    seg.map((p) => ({ point: point2d(p.x, sign * p.y) })),
                    { layerName: 'OUTLINE' },
                );
            }
            return;
        }
        if (input.frontEndShape === 'round' && frontTaper > EPSILON) {
            // R 形状: 楕円弧 = baseR - (baseR-tipR) * sqrt(1 - (z/L)^2)
            // 中心 (frontTaper, sign*baseR), 半径 (baseR-tipR), 開始角度に応じた ARC
            // ただし楕円弧は ELLIPSE エンティティ。簡易のため (baseR-tipR ≒ frontTaper の楕円) を
            // 円弧で近似する。半径 r が baseR-tipR と frontTaper の小さい方なら円弧として正確。
            // 一般には ELLIPSE が必要だが、ここでは ARC で近似 (バレル R は緩やかなため誤差は小さい)。
            const dr = baseR - tipR;
            // 円弧として: 中心 (frontTaper, sign*tipR), 半径 dr ではなく
            // 中心 (frontTaper, sign*(baseR - dr)) = (frontTaper, sign*tipR), 半径 dr,
            // 角度: チップ側端点 (0, sign*tipR) → 90度 (上半なら 180度開始から 90度終点)
            // sign=+1: ARC center=(frontTaper, tipR), startAngle=180, endAngle=90 (CCW)
            // sign=-1: ARC center=(frontTaper, -tipR), startAngle=270, endAngle=180 (CCW)
            // 実際は楕円なので ELLIPSE 推奨。ここでは ARC で近似する。
            if (Math.abs(dr - frontTaper) < 0.5) {
                // 円弧として十分近い → ARC エンティティ
                if (sign === 1) {
                    dxf.addArc(point3d(frontTaper, tipR, 0), dr, 180, 90, { layerName: 'OUTLINE' });
                } else {
                    dxf.addArc(point3d(frontTaper, -tipR, 0), dr, 270, 180, { layerName: 'OUTLINE' });
                }
            } else {
                // 楕円 → polyline で近似 (ELLIPSE は CAD 互換性が低い)
                const seg = sliceProfile(profile2D, 0, frontTaper);
                dxf.addLWPolyline(
                    seg.map((p) => ({ point: point2d(p.x, sign * p.y) })),
                    { layerName: 'OUTLINE' },
                );
            }
        } else if (frontTaper > EPSILON) {
            // テーパー: 単純な LINE
            dxf.addLine(
                point3d(0, sign * tipR, 0),
                point3d(frontTaper, sign * baseR, 0),
                { layerName: 'OUTLINE' },
            );
        }
    };

    const emitRearEnd = (sign: 1 | -1) => {
        if (useCustomOutline) {
            const seg = sliceProfile(profile2D, rearTaperStart, length);
            if (seg.length >= 2) {
                dxf.addLWPolyline(
                    seg.map((p) => ({ point: point2d(p.x, sign * p.y) })),
                    { layerName: 'OUTLINE' },
                );
            }
            return;
        }
        if (input.rearEndShape === 'round' && input.rearTaperLength > EPSILON) {
            const dr = baseR - threadR;
            if (Math.abs(dr - input.rearTaperLength) < 0.5) {
                if (sign === 1) {
                    dxf.addArc(point3d(rearTaperStart, threadR, 0), dr, 0, 90, { layerName: 'OUTLINE' });
                } else {
                    dxf.addArc(point3d(rearTaperStart, -threadR, 0), dr, 270, 360, { layerName: 'OUTLINE' });
                }
            } else {
                const seg = sliceProfile(profile2D, rearTaperStart, length);
                dxf.addLWPolyline(
                    seg.map((p) => ({ point: point2d(p.x, sign * p.y) })),
                    { layerName: 'OUTLINE' },
                );
            }
        } else if (input.rearTaperLength > EPSILON) {
            dxf.addLine(
                point3d(rearTaperStart, sign * baseR, 0),
                point3d(length, sign * threadR, 0),
                { layerName: 'OUTLINE' },
            );
        }
    };

    const emitBody = (sign: 1 | -1) => {
        // カスタム輪郭の場合は generator のプロファイルを LWPolyline で出力
        if (useCustomOutline) {
            const seg = sliceProfile(profile2D, frontTaper, rearTaperStart);
            if (seg.length >= 2) {
                dxf.addLWPolyline(
                    seg.map((p) => ({ point: point2d(p.x, sign * p.y) })),
                    { layerName: 'OUTLINE' },
                );
            }
            return;
        }

        // body 範囲と重なる非縦カットを startZ 順にソート
        const sortedCuts = input.cuts
            .filter((c) => c.type !== 'vertical' && c.endZ > frontTaper && c.startZ < rearTaperStart)
            .slice()
            .sort((a, b) => a.startZ - b.startZ);

        let cursor = frontTaper;

        const emitLine = (z1: number, r1: number, z2: number, r2: number) => {
            // 同一点 (長さ 0) のセグメントは出力しない
            if (Math.abs(z1 - z2) < EPSILON && Math.abs(r1 - r2) < EPSILON) return;
            dxf.addLine(
                point3d(z1, sign * r1, 0),
                point3d(z2, sign * r2, 0),
                { layerName: 'OUTLINE' },
            );
        };

        for (const cut of sortedCuts) {
            const cutStart = Math.max(cut.startZ, frontTaper);
            const cutEnd = Math.min(cut.endZ, rearTaperStart);

            // カット手前の land を 1 本の LINE で
            if (cutStart > cursor + EPSILON) {
                emitLine(cursor, baseR, cutStart, baseR);
            }

            // カット内: 各周期の頂点列を辿って LINE で連結
            const pitch = cut.properties.pitch ?? 1.0;
            const count = Math.max(0, Math.round((cutEnd - cutStart) / pitch));
            for (let i = 0; i < count; i++) {
                const cycleStart = cutStart + i * pitch;
                const verts = cutPeriodVertices(cut, cycleStart, baseR);
                for (let j = 0; j < verts.length - 1; j++) {
                    const a = verts[j];
                    const b = verts[j + 1];
                    emitLine(a.z, a.r, b.z, b.r);
                }
            }

            cursor = cutStart + count * pitch;
        }

        // 末尾の land
        if (cursor < rearTaperStart - EPSILON) {
            emitLine(cursor, baseR, rearTaperStart, baseR);
        }
    };

    // 上半輪郭 (Y > 0)
    emitFrontEnd(1);
    emitBody(1);
    emitRearEnd(1);

    // 下半輪郭 (Y < 0)
    emitFrontEnd(-1);
    emitBody(-1);
    emitRearEnd(-1);

    // 端面 (LINE)
    dxf.addLine(point3d(0, tipR, 0), point3d(0, -tipR, 0), { layerName: 'OUTLINE' });
    dxf.addLine(point3d(length, threadR, 0), point3d(length, -threadR, 0), { layerName: 'OUTLINE' });

    // ============================================================
    // 3. 穴 (LINE 4本ずつで矩形を構成)
    // ============================================================
    if (input.holeDepthFront > 0) {
        const fh = input.holeDepthFront;
        // 前穴: チップ側 (z=0) から内側 z=fh まで
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
