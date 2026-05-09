/**
 * バレル形状を AutoCAD 互換の DXF として書き出す。
 *
 * 出力レイアウト:
 *  - レイヤー OUTLINE: 上下対称の輪郭 (旋盤加工用断面図)
 *  - レイヤー HOLES:   前穴 / 後穴 (2BA, ⌀4.2mm)
 *  - レイヤー CENTER:  中心軸 (一点鎖線)
 *  - レイヤー DIM:     全長 / 最大径ラベル (TEXT)
 *  - レイヤー CUT_LABEL: カット位置注釈
 *
 * 座標系: AutoCAD 標準 (X 右, Y 上)。中心軸 = X 軸 (Y=0)。
 *         X=0 が左端 (チップ側), X=length が右端 (シャフト側)。
 *
 * 実装は @tarikjabiri/dxf を利用し、AutoCAD 2007 互換の DXF を生成する。
 */

import { DxfWriter, Colors, point3d, Units } from '@tarikjabiri/dxf';
import type { BarrelState } from '@/lib/store/useBarrelStore';
import { generateProfile } from '@/lib/math/generator';

const HOLE_RADIUS = 2.1;

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

    // レイヤー定義 (色番号: 7=白, 4=シアン, 1=赤, 2=黄, 3=緑)
    dxf.addLayer('OUTLINE', Colors.White, 'Continuous');
    dxf.addLayer('HOLES', Colors.Cyan, 'Continuous');
    dxf.addLayer('CENTER', Colors.Red, 'Continuous');
    dxf.addLayer('DIM', Colors.Yellow, 'Continuous');
    dxf.addLayer('CUT_LABEL', Colors.Green, 'Continuous');

    // 1. 中心軸
    dxf.addLine(
        point3d(-2, 0, 0),
        point3d(input.length + 2, 0, 0),
        { layerName: 'CENTER' },
    );

    // 2. 外形輪郭 (上下対称, 閉じたポリライン)
    // profile points: Vector2(r, z) → 軸方向 z は端から端まで, 半径 r が上下分。
    const outlineVertices = [
        ...profile.map((p) => ({ point: point3d(p.y, p.x, 0) })),
        ...[...profile].reverse().map((p) => ({ point: point3d(p.y, -p.x, 0) })),
    ];
    dxf.addPolyline3D(outlineVertices, {
        layerName: 'OUTLINE',
        flags: 1, // closed
    });

    // 3. 前穴
    if (input.holeDepthFront > 0) {
        const fh = input.holeDepthFront;
        dxf.addPolyline3D(
            [
                { point: point3d(0, HOLE_RADIUS, 0) },
                { point: point3d(fh, HOLE_RADIUS, 0) },
                { point: point3d(fh, -HOLE_RADIUS, 0) },
                { point: point3d(0, -HOLE_RADIUS, 0) },
            ],
            { layerName: 'HOLES', flags: 1 },
        );
    }

    // 4. 後穴
    if (input.holeDepthRear > 0) {
        const start = input.length - input.holeDepthRear;
        dxf.addPolyline3D(
            [
                { point: point3d(start, HOLE_RADIUS, 0) },
                { point: point3d(input.length, HOLE_RADIUS, 0) },
                { point: point3d(input.length, -HOLE_RADIUS, 0) },
                { point: point3d(start, -HOLE_RADIUS, 0) },
            ],
            { layerName: 'HOLES', flags: 1 },
        );
    }

    // 5. カット位置マーカー
    const baseR = input.maxDiameter / 2;
    const labelOffset = baseR + 4;
    for (const cut of input.cuts) {
        if (cut.type === 'vertical') continue;
        dxf.addLine(point3d(cut.startZ, baseR + 1, 0), point3d(cut.startZ, labelOffset, 0), { layerName: 'CUT_LABEL' });
        dxf.addLine(point3d(cut.endZ, baseR + 1, 0), point3d(cut.endZ, labelOffset, 0), { layerName: 'CUT_LABEL' });
        dxf.addLine(point3d(cut.startZ, labelOffset, 0), point3d(cut.endZ, labelOffset, 0), { layerName: 'CUT_LABEL' });
        const midZ = (cut.startZ + cut.endZ) / 2;
        dxf.addText(point3d(midZ - 5, labelOffset + 0.5, 0), 1.5, cut.type, { layerName: 'CUT_LABEL' });
    }

    // 6. 全長寸法
    const dimY = -baseR - 5;
    dxf.addLine(point3d(0, dimY, 0), point3d(input.length, dimY, 0), { layerName: 'DIM' });
    dxf.addLine(point3d(0, dimY - 1, 0), point3d(0, dimY + 1, 0), { layerName: 'DIM' });
    dxf.addLine(point3d(input.length, dimY - 1, 0), point3d(input.length, dimY + 1, 0), { layerName: 'DIM' });
    dxf.addText(
        point3d(input.length / 2 - 4, dimY - 3, 0),
        2,
        `L=${input.length.toFixed(1)}mm`,
        { layerName: 'DIM' },
    );

    // 7. 最大径表示
    dxf.addText(
        point3d(input.length / 2 - 6, baseR + 1.5, 0),
        2,
        `DIA ${input.maxDiameter.toFixed(1)}mm`,
        { layerName: 'DIM' },
    );

    // 8. 素材表示
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
