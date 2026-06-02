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
import type { BarrelState, CutZone, PolygonZone, ColorZone } from '@/lib/store/useBarrelStore';
import { generateProfile } from '@/lib/math/generator';
import { captureBarrelPngBlob } from './capture';

const HOLE_RADIUS = 2.1;
const EPSILON = 1e-6;
const COLLINEAR_TOLERANCE = 1e-6;

/** ORDER GRIP 公式 LINE アカウントの友だち追加 URL */
export const OFFICIAL_LINE_URL = 'https://lin.ee/wdJWNNK';

/**
 * ORDER GRIP 公式 LINE アカウントの Basic ID.
 * https://lin.ee/wdJWNNK のリダイレクト先 (line.me/R/ti/p/@750pfpxc) から取得。
 * NEXT_PUBLIC_LINE_OA_BASIC_ID 環境変数で上書き可能。
 */
const LINE_OA_BASIC_ID = process.env.NEXT_PUBLIC_LINE_OA_BASIC_ID ?? '@750pfpxc';

/**
 * DXF を Next.js API ルート経由で一時ストレージにアップロードする。
 *
 * API ルート (/api/upload-dxf) がサーバーサイドで 0x0.st / transfer.sh に
 * 転送するため、ブラウザ直結時に発生する CORS 制約と User-Agent ブロックを回避する。
 * デフォルトで 30 日後に自動削除される。
 */
/**
 * 任意のファイル(Blob)を /api/upload-dxf 経由で一時ホストにアップロードし、
 * ダウンロード強制プロキシ url と、ホスト生 url(rawUrl=インライン表示向き) を返す。
 */
export const uploadFileTemp = async (blob: Blob, filename: string): Promise<{ url: string; rawUrl: string }> => {
    const formData = new FormData();
    formData.append('file', blob, filename);

    const response = await fetch('/api/upload-dxf', {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`;
        try {
            const errBody = await response.json();
            if (errBody.error) detail = String(errBody.error);
        } catch {
            // body 解析失敗は無視
        }
        throw new Error(`アップロード失敗: ${detail}`);
    }

    const body = await response.json();
    if (typeof body.url !== 'string' || !body.url.startsWith('http')) {
        throw new Error(`予期しないレスポンス: ${JSON.stringify(body).slice(0, 200)}`);
    }
    const rawUrl = typeof body.rawUrl === 'string' && body.rawUrl.startsWith('http') ? body.rawUrl : body.url;
    return { url: body.url, rawUrl };
};

/** DXF 文字列を一時ホストにアップロードし、ダウンロード強制プロキシ URL を返す(後方互換) */
export const uploadDxfTemp = async (dxfContent: string, filename: string): Promise<string> => {
    const blob = new Blob([dxfContent], { type: 'application/dxf' });
    return (await uploadFileTemp(blob, filename)).url;
};

/**
 * 公式 LINE 宛の deep link を生成する。
 * Basic ID が設定されていれば oaMessage 形式 (1 タップ送信)、未設定なら友だち追加 URL を返す。
 */
const buildLineDeepLink = (textMessage: string): string => {
    if (LINE_OA_BASIC_ID) {
        // Basic ID 形式: '@xxxxxx' から '@' を除いた基本 ID 部分が必要
        const id = LINE_OA_BASIC_ID.startsWith('@') ? LINE_OA_BASIC_ID.slice(1) : LINE_OA_BASIC_ID;
        return `https://line.me/R/oaMessage/@${id}/?${encodeURIComponent(textMessage)}`;
    }
    return OFFICIAL_LINE_URL;
};

interface DxfBarrelInput {
    length: number;
    maxDiameter: number;
    cuts: BarrelState['cuts'];
    frontTaperLength: number;
    rearTaperLength: number;
    holeDepthFront: number;
    holeDepthRear: number;
    outline: BarrelState['outline'];
    outlineInterp?: BarrelState['outlineInterp'];
    frontEndShape: BarrelState['frontEndShape'];
    rearEndShape: BarrelState['rearEndShape'];
    materialDensity: number;
    /** 多角形ゾーン: 指定区間の断面を正多角形に (対角=最大径)。空/未指定 = 全長真円 */
    polygonZones?: PolygonZone[];
    /** カラー区間: 指定区間に accentColorName のアルマイト色を塗る */
    colorZones?: ColorZone[];
    /** アクセント色の名称 (DXF 注記用)。例 'GOLD' */
    accentColorName?: string;
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
        input.outlineInterp ?? 'smooth',
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
    dxf.addLayer('SECTION', Colors.Magenta, 'Continuous');
    dxf.addLayer('COLOR', Colors.Blue, 'Continuous');

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
        .filter((c) => c.type !== 'vertical' && c.type !== 'helical' && c.type !== 'cross' && c.startZ < c.endZ)
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

    /**
     * 3 点 P1, P2, P3 を通る円弧の bulge 値を計算する。
     * P1 = 開始点、P3 = 終了点、P2 = 中間点 (この点を経由する弧)
     * 戻り値: tan(中心角/4) に符号を付けたもの (LWPolyline 仕様)
     *         P1→P3 が CCW で P2 を通る場合は正、CW なら負
     */
    const computeBulge = (P1: { z: number; r: number }, P2: { z: number; r: number }, P3: { z: number; r: number }): number => {
        const dx = P3.z - P1.z;
        const dy = P3.r - P1.r;
        const ax = P2.z - P1.z;
        const ay = P2.r - P1.r;
        const chordLen = Math.sqrt(dx * dx + dy * dy);
        if (chordLen < EPSILON) return 0;
        // 2D cross product: 正なら P2 が P1→P3 の左、負なら右
        const cross = dx * ay - dy * ax;
        const sagitta = Math.abs(cross) / chordLen;
        if (sagitta < EPSILON) return 0;
        // bulge = 2 * sagitta / chord_length, 符号: P2 が CCW 側 (左) なら正、CW 側 (右) なら負
        // ただし DXF では「弧が CCW 方向に進む」を正とする → P2 が右側で CCW (apex 経由で角度増加) になるケース
        // 検証: 半円 (z=0→2, apex z=1,y=-1) では cross=2*-1-0*1=-2 (右側), 弧は CCW (角度 180→270→360) で bulge=+1
        // → bulge_sign = -sign(cross)
        return -Math.sign(cross) * 2 * sagitta / chordLen;
    };

    /** カット 1 周期分の頂点列 (上半側).
     *  各頂点の r は baseRAt(z) を基準にしてテーパー傾斜に追従する。
     *  これにより、カットがテーパー領域に入っても peak (land) が傾斜と平行で隙間が生じない。
     */
    const getCutPeriodVertices = (cut: CutZone, cycleStart: number): Vertex[] => {
        const pitch = cut.properties.pitch ?? 1.0;
        const depth = cut.properties.depth ?? 0.5;
        const cycleEnd = cycleStart + pitch;

        // peak r は baseRAt(z) で各 z 位置の値を採用
        // valley r は peak から depth だけ深い (baseRAt(z) - depth)
        const peakAt = (z: number): number => baseRAt(z);
        const valleyAt = (z: number): number => baseRAt(z) - depth;

        switch (cut.type) {
            case 'ring':
            case 'micro': {
                const cw = Math.min(cut.properties.cutWidth ?? pitch * 0.5, pitch * 0.95);
                const z1 = cycleStart;
                const z2 = cycleStart + cw;
                const verts: Vertex[] = [
                    { z: z1, r: peakAt(z1), bulge: 0 },
                    { z: z1, r: valleyAt(z1), bulge: 0 },
                    { z: z2, r: valleyAt(z2), bulge: 0 },
                    { z: z2, r: peakAt(z2), bulge: 0 },
                ];
                if (pitch - cw > EPSILON) {
                    verts.push({ z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 });
                }
                return verts;
            }
            case 'ring_double': {
                const cw = cut.properties.cutWidth ?? pitch * 0.2;
                const gw = cut.properties.gapWidth ?? pitch * 0.15;
                const z1 = cycleStart;
                const z2 = cycleStart + cw;
                const z3 = cycleStart + cw + gw;
                const z4 = cycleStart + 2 * cw + gw;
                const verts: Vertex[] = [
                    { z: z1, r: peakAt(z1), bulge: 0 },
                    { z: z1, r: valleyAt(z1), bulge: 0 },
                    { z: z2, r: valleyAt(z2), bulge: 0 },
                    { z: z2, r: peakAt(z2), bulge: 0 },
                    { z: z3, r: peakAt(z3), bulge: 0 },
                    { z: z3, r: valleyAt(z3), bulge: 0 },
                    { z: z4, r: valleyAt(z4), bulge: 0 },
                    { z: z4, r: peakAt(z4), bulge: 0 },
                ];
                if (pitch - 2 * cw - gw > EPSILON) {
                    verts.push({ z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 });
                }
                return verts;
            }
            case 'ring_triple': {
                const cw = cut.properties.cutWidth ?? pitch * 0.15;
                const gw = cut.properties.gapWidth ?? pitch * 0.1;
                const z1 = cycleStart;
                const z2 = cycleStart + cw;
                const z3 = cycleStart + cw + gw;
                const z4 = cycleStart + 2 * cw + gw;
                const z5 = cycleStart + 2 * cw + 2 * gw;
                const z6 = cycleStart + 3 * cw + 2 * gw;
                const verts: Vertex[] = [
                    { z: z1, r: peakAt(z1), bulge: 0 },
                    { z: z1, r: valleyAt(z1), bulge: 0 },
                    { z: z2, r: valleyAt(z2), bulge: 0 },
                    { z: z2, r: peakAt(z2), bulge: 0 },
                    { z: z3, r: peakAt(z3), bulge: 0 },
                    { z: z3, r: valleyAt(z3), bulge: 0 },
                    { z: z4, r: valleyAt(z4), bulge: 0 },
                    { z: z4, r: peakAt(z4), bulge: 0 },
                    { z: z5, r: peakAt(z5), bulge: 0 },
                    { z: z5, r: valleyAt(z5), bulge: 0 },
                    { z: z6, r: valleyAt(z6), bulge: 0 },
                    { z: z6, r: peakAt(z6), bulge: 0 },
                ];
                if (pitch - 3 * cw - 2 * gw > EPSILON) {
                    verts.push({ z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 });
                }
                return verts;
            }
            case 'ring_r':
            case 'scallop': {
                // 3 点 (start, midpoint+depth, end) を通る円弧として bulge を計算
                // テーパーの場合、start/end の r は異なるので chord は斜めになる
                const aw = getActiveWidth(cut, pitch);
                const z1 = cycleStart;
                const z2 = cycleStart + aw / 2;
                const z3 = cycleStart + aw;
                const P1 = { z: z1, r: peakAt(z1) };
                const P2 = { z: z2, r: valleyAt(z2) };
                const P3 = { z: z3, r: peakAt(z3) };
                const bulge = computeBulge(P1, P2, P3);
                const verts: Vertex[] = [
                    { z: P1.z, r: P1.r, bulge },
                    { z: P3.z, r: P3.r, bulge: 0 },
                ];
                if (pitch - aw > EPSILON) {
                    verts.push({ z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 });
                }
                return verts;
            }
            case 'ring_v': {
                const aw = getActiveWidth(cut, pitch);
                const z1 = cycleStart;
                const z2 = cycleStart + aw / 2;
                const z3 = cycleStart + aw;
                return [
                    { z: z1, r: peakAt(z1), bulge: 0 },
                    { z: z2, r: valleyAt(z2), bulge: 0 },
                    { z: z3, r: peakAt(z3), bulge: 0 },
                    ...(pitch - aw > EPSILON ? [{ z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 }] : []),
                ];
            }
            case 'canyon': {
                const aw = getActiveWidth(cut, pitch);
                const z1 = cycleStart;
                const z2 = cycleStart + 0.2 * aw;
                const z3 = cycleStart + 0.8 * aw;
                const z4 = cycleStart + aw;
                return [
                    { z: z1, r: peakAt(z1), bulge: 0 },
                    { z: z2, r: valleyAt(z2), bulge: 0 },
                    { z: z3, r: valleyAt(z3), bulge: 0 },
                    { z: z4, r: peakAt(z4), bulge: 0 },
                    ...(pitch - aw > EPSILON ? [{ z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 }] : []),
                ];
            }
            case 'shark': {
                // 常に full pitch をスパン (peak に land を作らず、ピン角を保持)
                // 形状: valley → 線形ランプ → peak (ピン角) → 急降下 → 次の valley
                const z1 = cycleStart;
                const z2 = cycleStart + pitch;
                return [
                    { z: z1, r: peakAt(z1), bulge: 0 },
                    { z: z1, r: valleyAt(z1), bulge: 0 },
                    { z: z2, r: peakAt(z2), bulge: 0 },
                ];
            }
            case 'wing': {
                // shark 形状 + 溝間隔 (land)
                // [cycleStart, cycleStart + cutWidth]: 線形ランプ (シャーク部分)
                // [cycleStart + cutWidth, cycleEnd]: peak の land (溝間隔)
                // 全て直線、ピン角あり
                const aw = getActiveWidth(cut, pitch);
                const z1 = cycleStart;
                const z2 = cycleStart + aw;
                const verts: Vertex[] = [
                    { z: z1, r: peakAt(z1), bulge: 0 },
                    { z: z1, r: valleyAt(z1), bulge: 0 },
                    { z: z2, r: peakAt(z2), bulge: 0 },
                ];
                if (pitch - aw > EPSILON) {
                    verts.push({ z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 });
                }
                return verts;
            }
            case 'step': {
                const aw = getActiveWidth(cut, pitch);
                const midOff = depth * 0.5;
                const z1 = cycleStart;
                const z2 = cycleStart + 0.3 * aw;
                const z3 = cycleStart + 0.6 * aw;
                const z4 = cycleStart + aw;
                return [
                    { z: z1, r: peakAt(z1), bulge: 0 },
                    { z: z2, r: peakAt(z2), bulge: 0 },
                    { z: z2, r: peakAt(z2) - midOff, bulge: 0 },
                    { z: z3, r: peakAt(z3) - midOff, bulge: 0 },
                    { z: z3, r: valleyAt(z3), bulge: 0 },
                    { z: z4, r: valleyAt(z4), bulge: 0 },
                    { z: z4, r: peakAt(z4), bulge: 0 },
                    ...(pitch - aw > EPSILON ? [{ z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 }] : []),
                ];
            }
            case 'stair': {
                const aw = getActiveWidth(cut, pitch);
                const z1 = cycleStart;
                const z2 = cycleStart + 0.2 * aw;
                const z3 = cycleStart + 0.5 * aw;
                const z4 = cycleStart + 0.7 * aw;
                return [
                    { z: z1, r: peakAt(z1), bulge: 0 },
                    { z: z2, r: valleyAt(z2), bulge: 0 },
                    { z: z3, r: valleyAt(z3), bulge: 0 },
                    { z: z4, r: peakAt(z4), bulge: 0 },
                    ...(pitch - aw > EPSILON ? [{ z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 }] : []),
                ];
            }
            default:
                return [
                    { z: cycleStart, r: peakAt(cycleStart), bulge: 0 },
                    { z: cycleEnd, r: peakAt(cycleEnd), bulge: 0 },
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
    // 3. 全輪郭を 1 本の閉じた LWPolyline として出力
    //    上半 → 後端面 → 下半 (逆順) → 前端面 (closed flag で自動)
    //    単一エンティティのため、構成要素間のトレランス (隙間) が原理的に発生しない
    // ============================================================
    const closedOutline: Vertex[] = [];

    // 上半: z=0 → z=length
    closedOutline.push(...topVerts);

    // 後端面の下端: (length, -threadR). 上半の最後の頂点 (length, threadR) と直線で結ばれる
    // 下半 (逆順, r 符号反転)
    // bulge 符号は mirror+reverse で保持されるため、top の i-1 → i の bulge を bottom[N-1-i] の前頂点として保持
    for (let i = topVerts.length - 1; i >= 0; i--) {
        const v = topVerts[i];
        // 上半最後の頂点の bulge は使わない (後端面 LINE への直線). i=N-1 のとき bottom 最初の bulge=0
        const prevBulge = i > 0 ? topVerts[i - 1].bulge : 0;
        closedOutline.push({ z: v.z, r: -v.r, bulge: prevBulge });
    }

    if (closedOutline.length >= 2) {
        dxf.addLWPolyline(
            closedOutline.map((v) => ({ point: point2d(v.z, v.r), bulge: v.bulge })),
            { layerName: 'OUTLINE', flags: LWPolylineFlags.Closed },
        );
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
        // 縦溝は従来どおり断面図に注釈しない (3D固有)
        if (cut.type === 'vertical') continue;
        // 斜目/綾目ローレットは側面輪郭に出ないため、ゾーンにパターン注記を描く
        if (cut.type === 'helical' || cut.type === 'cross') {
            const midZ = (cut.startZ + cut.endZ) / 2;
            const n = cut.properties.itemCount ?? 12;
            const label = cut.type === 'cross' ? `KNURL diamond x${n}` : `SPIRAL x${n}`;
            dxf.addText(point3d(midZ - 8, labelOffset + 0.5, 0), 1.5, `${label} z${cut.startZ.toFixed(0)}-${cut.endZ.toFixed(0)}`, { layerName: 'CUT_LABEL' });
            continue;
        }
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

    // ============================================================
    // 9. 断面図 (多角形ゾーンごと) — バレル前端の左側に縦に並べて作図
    //    対角(頂点)=最大径で円に内接。穴は円形。
    // ============================================================
    const sectionZones = (input.polygonZones ?? []).filter((z) => z.sides >= 5);
    sectionZones.forEach((zone, zi) => {
        const N = zone.sides;
        const R = baseR; // 円周半径 = 最大径/2
        const cx = -(R + 14); // 前端 (z=0) のさらに左に配置
        const cy = -zi * (2 * R + 8); // ゾーンごとに下へずらして並べる
        const vertexOffset = Math.PI / 2; // 頂点を上に向ける

        const polyPts = [];
        for (let k = 0; k < N; k++) {
            const ang = vertexOffset + (k / N) * Math.PI * 2;
            polyPts.push({ point: point2d(cx + R * Math.cos(ang), cy + R * Math.sin(ang)) });
        }
        dxf.addLWPolyline(polyPts, { layerName: 'SECTION', flags: LWPolylineFlags.Closed });

        // 穴 (円形) を多角ポリラインで近似
        const HOLE_SEG = 24;
        const holePts = [];
        for (let k = 0; k < HOLE_SEG; k++) {
            const ang = (k / HOLE_SEG) * Math.PI * 2;
            holePts.push({ point: point2d(cx + HOLE_RADIUS * Math.cos(ang), cy + HOLE_RADIUS * Math.sin(ang)) });
        }
        dxf.addLWPolyline(holePts, { layerName: 'HOLES', flags: LWPolylineFlags.Closed });

        dxf.addText(
            point3d(cx - R, cy - R - 3, 0),
            1.8,
            `SECTION ${N}-gon z${zone.startZ.toFixed(0)}-${zone.endZ.toFixed(0)}mm`,
            { layerName: 'SECTION' },
        );
    });

    // ============================================================
    // 10. カラー区間 (COLOR レイヤー注記) — アルマイト塗装指示
    //     周方向の塗装なので側面輪郭には出さず、バレル上部にブラケット注記を描く
    // ============================================================
    const cZones = input.colorZones ?? [];
    if (cZones.length > 0 && input.accentColorName) {
        const cBot = baseR + 6;
        const cTop = baseR + 9;
        for (const cz of cZones) {
            const midZ = (cz.startZ + cz.endZ) / 2;
            dxf.addLine(point3d(cz.startZ, cBot, 0), point3d(cz.startZ, cTop, 0), { layerName: 'COLOR' });
            dxf.addLine(point3d(cz.endZ, cBot, 0), point3d(cz.endZ, cTop, 0), { layerName: 'COLOR' });
            dxf.addLine(point3d(cz.startZ, cTop, 0), point3d(cz.endZ, cTop, 0), { layerName: 'COLOR' });
            dxf.addText(
                point3d(midZ - 6, cTop + 0.5, 0),
                1.8,
                `COLOR ${input.accentColorName} z${cz.startZ.toFixed(0)}-${cz.endZ.toFixed(0)}`,
                { layerName: 'COLOR' },
            );
        }
    }

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
 * 共有結果のステータス。
 * - 'file-share': Web Share API でファイルそのものを共有 (LINE に添付ファイルとして渡せる)
 * - 'auto-line':  oaMessage deep link で公式 LINE のチャットに URL プリフィル
 * - 'url-share':  Web Share API で URL を共有 (テキスト経由)
 * - 'clipboard':  URL をクリップボードにコピー + 友だち追加ページを開いた
 * - 'failed':     アップロード自体に失敗した (通信エラー等)
 */
export type ShareResult =
    | { status: 'file-share' }
    | { status: 'auto-line'; url: string }
    | { status: 'url-share'; url: string }
    | { status: 'clipboard'; url: string }
    | { status: 'failed'; error: string };

/**
 * DXF を公式 LINE 宛に送る。Basic ID で公式アカウントのチャットを直接開くため、
 * ユーザーは送付先を選択する必要がない。
 *
 * フロー:
 *   1. catbox.moe に DXF をアップロード (公開 URL 取得)
 *   2. https://line.me/R/oaMessage/@<basic-id>/?<URL> を開く
 *      → LINE アプリで ORDER GRIP 公式アカウントのチャットが URL プリフィル状態で開く
 *   3. ユーザーは「送信」を 1 タップするだけ
 *
 * フォールバック (Basic ID 未設定 or LINE 起動失敗):
 *   - Web Share API (URL) → シェアシート (要送付先選択)
 *   - クリップボードコピー + 友だち追加ページ
 *
 * 注意: LINE 仕様により「ファイル添付済み」の状態で deep link を開くことは不可能。
 *       そのため URL を送る方式となる。受信側でURLをタップすればDXFがダウンロードされる。
 */
export const shareDxf = async (input: DxfBarrelInput, filename?: string): Promise<ShareResult> => {
    const dxf = generateDxf(input);
    const name = filename ?? buildFilename();
    const imageName = name.replace(/\.dxf$/i, '.png');

    // 1. DXF をアップロード (必須)
    const dxfBlob = new Blob([dxf], { type: 'application/dxf' });
    let dxfUrl: string;
    try {
        dxfUrl = (await uploadFileTemp(dxfBlob, name)).url;
    } catch (err) {
        return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }

    // 2. 3D レンダー画像をキャプチャしてアップロード (任意・失敗しても DXF だけで続行)
    //    画像はインライン表示させたいのでホスト生 URL(rawUrl) を使う。
    const imageBlob = captureBarrelPngBlob();
    let imageUrl: string | null = null;
    if (imageBlob) {
        try {
            imageUrl = (await uploadFileTemp(imageBlob, imageName)).rawUrl;
        } catch {
            imageUrl = null;
        }
    }

    const message = imageUrl
        ? `ORDER GRIP バレル設計のご相談\n■3Dイメージ: ${imageUrl}\n■DXF: ${dxfUrl}`
        : `ORDER GRIP バレル設計のご相談\n■DXF: ${dxfUrl}`;

    // 3. Basic ID で公式アカウントのチャットを直接開く (送付先選択不要、画像+DXF の URL 入り)
    if (LINE_OA_BASIC_ID) {
        const link = buildLineDeepLink(message);
        window.open(link, '_blank', 'noopener,noreferrer');
        return { status: 'auto-line', url: dxfUrl };
    }

    // 4. フォールバック: Web Share API (可能なら DXF + 画像の両ファイルを添付)
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    const files: File[] = [new File([dxfBlob], name, { type: 'application/dxf' })];
    if (imageBlob) files.push(new File([imageBlob], imageName, { type: 'image/png' }));
    if (typeof nav.share === 'function') {
        try {
            if (nav.canShare?.({ files })) {
                await nav.share({ title: 'ORDER GRIP バレル設計', text: message, files });
                return { status: 'file-share' };
            }
            await nav.share({ title: 'ORDER GRIP バレル設計', text: message, url: dxfUrl });
            return { status: 'url-share', url: dxfUrl };
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                return { status: 'url-share', url: dxfUrl };
            }
        }
    }

    // 5. クリップボードコピー + 友だち追加ページ
    try {
        await navigator.clipboard.writeText(message);
    } catch {
        // clipboard 失敗は致命的ではない
    }
    return { status: 'clipboard', url: dxfUrl };
};
