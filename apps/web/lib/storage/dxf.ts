/**
 * バレル形状を AutoCAD 互換の DXF (R12 ASCII) として書き出す。
 *
 * 出力レイアウト:
 *  - レイヤー OUTLINE: 上下対称の輪郭 (旋盤加工用断面図)
 *  - レイヤー HOLES:   前穴 / 後穴 (2BA, ⌀4.2mm)
 *  - レイヤー CENTER:  中心軸 (一点鎖線)
 *  - レイヤー DIM:     全長 / 最大径ラベル (TEXT)
 *
 * 座標系: AutoCAD 標準 (X 右, Y 上)。中心軸 = X 軸 (Y=0)。
 *         Z=0 が左端 (チップ側), Z=length が右端 (シャフト側)。
 */

import type { BarrelState } from '@/lib/store/useBarrelStore';
import { generateProfile } from '@/lib/math/generator';

const HOLE_RADIUS = 2.1; // 2BA ホール半径

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

const fmt = (n: number): string => n.toFixed(3);

const writeHeader = (lines: string[]): void => {
    lines.push(
        '0', 'SECTION',
        '2', 'HEADER',
        '9', '$ACADVER', '1', 'AC1009',  // R12
        '9', '$INSUNITS', '70', '4',      // 4 = millimeters
        '9', '$EXTMIN', '10', '0', '20', '0',
        '9', '$EXTMAX', '10', '100', '20', '50',
        '0', 'ENDSEC',
    );
};

const writeTables = (lines: string[]): void => {
    lines.push(
        '0', 'SECTION',
        '2', 'TABLES',
        // LAYER table
        '0', 'TABLE', '2', 'LAYER', '70', '4',
        // OUTLINE layer (white)
        '0', 'LAYER', '2', 'OUTLINE', '70', '0', '62', '7', '6', 'CONTINUOUS',
        // HOLES layer (cyan)
        '0', 'LAYER', '2', 'HOLES', '70', '0', '62', '4', '6', 'CONTINUOUS',
        // CENTER layer (red, dashed)
        '0', 'LAYER', '2', 'CENTER', '70', '0', '62', '1', '6', 'CENTER',
        // DIM layer (yellow)
        '0', 'LAYER', '2', 'DIM', '70', '0', '62', '2', '6', 'CONTINUOUS',
        // CUT_LABEL layer (green)
        '0', 'LAYER', '2', 'CUT_LABEL', '70', '0', '62', '3', '6', 'CONTINUOUS',
        '0', 'ENDTAB',
        '0', 'ENDSEC',
    );
};

const lwpolyline = (lines: string[], layer: string, points: Array<{ x: number; y: number }>, closed = false): void => {
    lines.push(
        '0', 'POLYLINE',
        '8', layer,
        '66', '1',
        '70', closed ? '1' : '0',
        '10', '0', '20', '0', '30', '0',
    );
    for (const p of points) {
        lines.push(
            '0', 'VERTEX',
            '8', layer,
            '10', fmt(p.x),
            '20', fmt(p.y),
            '30', '0',
        );
    }
    lines.push('0', 'SEQEND');
};

const dxfLine = (lines: string[], layer: string, x1: number, y1: number, x2: number, y2: number): void => {
    lines.push(
        '0', 'LINE',
        '8', layer,
        '10', fmt(x1), '20', fmt(y1), '30', '0',
        '11', fmt(x2), '21', fmt(y2), '31', '0',
    );
};

const dxfText = (lines: string[], layer: string, x: number, y: number, height: number, text: string): void => {
    lines.push(
        '0', 'TEXT',
        '8', layer,
        '10', fmt(x), '20', fmt(y), '30', '0',
        '40', fmt(height),
        '1', text,
    );
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

    // profile points: Vector2(r, z). 軸方向 z は端から端まで, 半径 r が上下対称分。
    // 上輪郭: (z, +r), 下輪郭: (z, -r)
    const upper = profile.map((p) => ({ x: p.y, y: p.x }));
    const lower = profile.map((p) => ({ x: p.y, y: -p.x })).reverse();
    const closedOutline = [...upper, ...lower];

    const lines: string[] = [];
    writeHeader(lines);
    writeTables(lines);

    // ENTITIES section
    lines.push('0', 'SECTION', '2', 'ENTITIES');

    // 1. 中心軸 (CENTER layer)
    dxfLine(lines, 'CENTER', -2, 0, input.length + 2, 0);

    // 2. 外形輪郭 (closed polyline, OUTLINE layer)
    lwpolyline(lines, 'OUTLINE', closedOutline, true);

    // 3. 前穴 (HOLES) — 矩形で深さ holeDepthFront, 半径 HOLE_RADIUS
    if (input.holeDepthFront > 0) {
        const fh = input.holeDepthFront;
        lwpolyline(lines, 'HOLES', [
            { x: 0, y: HOLE_RADIUS },
            { x: fh, y: HOLE_RADIUS },
            { x: fh, y: -HOLE_RADIUS },
            { x: 0, y: -HOLE_RADIUS },
        ], true);
    }

    // 4. 後穴 (HOLES)
    if (input.holeDepthRear > 0) {
        const start = input.length - input.holeDepthRear;
        lwpolyline(lines, 'HOLES', [
            { x: start, y: HOLE_RADIUS },
            { x: input.length, y: HOLE_RADIUS },
            { x: input.length, y: -HOLE_RADIUS },
            { x: start, y: -HOLE_RADIUS },
        ], true);
    }

    // 5. カット位置マーカー (CUT_LABEL) — 各カットの開始/終了 z 位置に縦線
    const baseR = input.maxDiameter / 2;
    const labelOffset = baseR + 4;
    for (const cut of input.cuts) {
        if (cut.type === 'vertical') continue;
        // 範囲を上方に注釈
        dxfLine(lines, 'CUT_LABEL', cut.startZ, baseR + 1, cut.startZ, labelOffset);
        dxfLine(lines, 'CUT_LABEL', cut.endZ, baseR + 1, cut.endZ, labelOffset);
        dxfLine(lines, 'CUT_LABEL', cut.startZ, labelOffset, cut.endZ, labelOffset);
        const midZ = (cut.startZ + cut.endZ) / 2;
        dxfText(lines, 'CUT_LABEL', midZ - 5, labelOffset + 0.5, 1.5, cut.type);
    }

    // 6. 寸法 (DIM)
    const dimY = -baseR - 5;
    dxfLine(lines, 'DIM', 0, dimY, input.length, dimY);
    dxfLine(lines, 'DIM', 0, dimY - 1, 0, dimY + 1);
    dxfLine(lines, 'DIM', input.length, dimY - 1, input.length, dimY + 1);
    dxfText(lines, 'DIM', input.length / 2 - 4, dimY - 3, 2, `L=${input.length.toFixed(1)}mm`);

    // 7. 最大径表示
    dxfText(lines, 'DIM', input.length / 2 - 6, baseR + 1.5, 2, `⌀${input.maxDiameter.toFixed(1)}mm`);

    // 8. 素材表示
    const materialName = (() => {
        switch (input.materialDensity) {
            case 18.0: return 'Tungsten 95%';
            case 17.0: return 'Tungsten 90%';
            case 15.0: return 'Tungsten 80%';
            case 13.5: return 'Tungsten 70%';
            default: return `Density ${input.materialDensity.toFixed(1)} g/cm3`;
        }
    })();
    dxfText(lines, 'DIM', 0, dimY - 6, 2, materialName);

    lines.push('0', 'ENDSEC');
    lines.push('0', 'EOF');

    return lines.join('\r\n') + '\r\n';
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
        // User cancelled or share failed
        if ((err as Error).name === 'AbortError') return true;
        return false;
    }
};
