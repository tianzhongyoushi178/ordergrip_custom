import type { CutZone } from '@/lib/store/useBarrelStore';

/** カット 1 ピッチ分の頂点列。隣接する頂点間は LINE で結ばれる。 */
export interface CutVertex {
    z: number;
    r: number;
}

/**
 * カット種別ごとの 1 周期分の幾何プリミティブ（頂点列）を返す。
 * 頂点列の隣接ペアを LINE で結ぶことで、カットの正確な形状が再現される。
 *
 * 入口は (cycleStart, baseR) の peak、出口は (cycleStart + pitch, baseR) の peak で揃う。
 * これにより周期の連結や前後 land との接続にギャップが発生しない。
 *
 * generator.ts のカットパターンロジックと一致する。
 */
export function cutPeriodVertices(cut: CutZone, cycleStart: number, baseR: number): CutVertex[] {
    const pitch = cut.properties.pitch ?? 1.0;
    const depth = cut.properties.depth ?? 0.5;
    const peakR = baseR;
    const valleyR = baseR - depth;

    /** 非 groove 系カットの実効幅 (cutWidth が pitch 未満なら短縮) */
    const activeWidth = (() => {
        const aw = cut.properties.cutWidth;
        if (aw !== undefined && aw < pitch) return aw;
        return pitch;
    })();

    switch (cut.type) {
        case 'ring':
        case 'micro': {
            // 矩形溝: |__|--
            const cw = Math.min(cut.properties.cutWidth ?? pitch * 0.5, pitch * 0.95);
            return [
                { z: cycleStart, r: peakR },
                { z: cycleStart, r: valleyR },              // wall down
                { z: cycleStart + cw, r: valleyR },          // bottom
                { z: cycleStart + cw, r: peakR },            // wall up
                { z: cycleStart + pitch, r: peakR },         // land
            ];
        }

        case 'ring_double': {
            // ダブル溝: ||_||_-
            const cw = cut.properties.cutWidth ?? pitch * 0.2;
            const gw = cut.properties.gapWidth ?? pitch * 0.15;
            const z0 = cycleStart;
            return [
                { z: z0, r: peakR },
                { z: z0, r: valleyR },
                { z: z0 + cw, r: valleyR },
                { z: z0 + cw, r: peakR },
                { z: z0 + cw + gw, r: peakR },
                { z: z0 + cw + gw, r: valleyR },
                { z: z0 + 2 * cw + gw, r: valleyR },
                { z: z0 + 2 * cw + gw, r: peakR },
                { z: z0 + pitch, r: peakR },
            ];
        }

        case 'ring_triple': {
            // トリプル溝: ||_||_||--
            const cw = cut.properties.cutWidth ?? pitch * 0.15;
            const gw = cut.properties.gapWidth ?? pitch * 0.1;
            const z0 = cycleStart;
            return [
                { z: z0, r: peakR },
                { z: z0, r: valleyR },
                { z: z0 + cw, r: valleyR },
                { z: z0 + cw, r: peakR },
                { z: z0 + cw + gw, r: peakR },
                { z: z0 + cw + gw, r: valleyR },
                { z: z0 + 2 * cw + gw, r: valleyR },
                { z: z0 + 2 * cw + gw, r: peakR },
                { z: z0 + 2 * cw + 2 * gw, r: peakR },
                { z: z0 + 2 * cw + 2 * gw, r: valleyR },
                { z: z0 + 3 * cw + 2 * gw, r: valleyR },
                { z: z0 + 3 * cw + 2 * gw, r: peakR },
                { z: z0 + pitch, r: peakR },
            ];
        }

        case 'ring_v': {
            // V字溝: \/
            return [
                { z: cycleStart, r: peakR },
                { z: cycleStart + activeWidth / 2, r: valleyR },
                { z: cycleStart + activeWidth, r: peakR },
                { z: cycleStart + pitch, r: peakR },
            ];
        }

        case 'ring_r':
        case 'scallop': {
            // 半サイン波 (U字/丸底): r = peakR - depth * sin(factor * π), factor 0..1
            // 32 分割で滑らかに近似
            const points: CutVertex[] = [];
            const segments = 32;
            for (let i = 0; i <= segments; i++) {
                const f = i / segments;
                const z = cycleStart + f * activeWidth;
                const rOff = depth * Math.sin(f * Math.PI);
                points.push({ z, r: peakR - rOff });
            }
            if (activeWidth < pitch) {
                points.push({ z: cycleStart + pitch, r: peakR });
            }
            return points;
        }

        case 'canyon': {
            // 台形溝: \___/  (20% taper down, 60% flat, 20% taper up)
            return [
                { z: cycleStart, r: peakR },
                { z: cycleStart + 0.2 * activeWidth, r: valleyR },
                { z: cycleStart + 0.8 * activeWidth, r: valleyR },
                { z: cycleStart + activeWidth, r: peakR },
                { z: cycleStart + pitch, r: peakR },
            ];
        }

        case 'shark': {
            // シャーク: 起点で valley → 急上昇 → peak → land
            // generator: r -= depth * (1 - factor)
            return [
                { z: cycleStart, r: peakR },
                { z: cycleStart, r: valleyR },                  // 急下降
                { z: cycleStart + activeWidth, r: peakR },      // 直線上昇
                { z: cycleStart + pitch, r: peakR },            // land
            ];
        }

        case 'wing': {
            // 曲線テーパー: r -= depth * (1 - factor^0.6)
            // 16 分割で曲線近似
            const points: CutVertex[] = [];
            points.push({ z: cycleStart, r: peakR });
            points.push({ z: cycleStart, r: valleyR });          // 急下降から始まる
            const segments = 16;
            for (let i = 1; i <= segments; i++) {
                const f = i / segments;
                const rOff = depth * (1 - Math.pow(f, 0.6));
                points.push({ z: cycleStart + f * activeWidth, r: peakR - rOff });
            }
            if (activeWidth < pitch) {
                points.push({ z: cycleStart + pitch, r: peakR });
            }
            return points;
        }

        case 'step': {
            // 3段ステップ: 30% land + 30% mid + 40% deep
            const midR = peakR - depth * 0.5;
            return [
                { z: cycleStart, r: peakR },
                { z: cycleStart + 0.3 * activeWidth, r: peakR },
                { z: cycleStart + 0.3 * activeWidth, r: midR },
                { z: cycleStart + 0.6 * activeWidth, r: midR },
                { z: cycleStart + 0.6 * activeWidth, r: valleyR },
                { z: cycleStart + activeWidth, r: valleyR },
                { z: cycleStart + activeWidth, r: peakR },
                { z: cycleStart + pitch, r: peakR },
            ];
        }

        case 'stair': {
            // 対称ステア: ramp down (20%) + deep (30%) + ramp up (20%) + land (30%)
            return [
                { z: cycleStart, r: peakR },
                { z: cycleStart + 0.2 * activeWidth, r: valleyR },
                { z: cycleStart + 0.5 * activeWidth, r: valleyR },
                { z: cycleStart + 0.7 * activeWidth, r: peakR },
                { z: cycleStart + pitch, r: peakR },
            ];
        }

        default:
            // 既知でない型: 平坦のまま
            return [
                { z: cycleStart, r: peakR },
                { z: cycleStart + pitch, r: peakR },
            ];
    }
}

/**
 * 1 つのカット全体について、開始端 z=startZ から終端 z=endZ までの全周期の頂点を連結して返す。
 * 周期間で peak が共有されるため重複頂点は除去される。
 */
export function cutAllVertices(cut: CutZone, baseR: number): CutVertex[] {
    const pitch = cut.properties.pitch ?? 1.0;
    const count = Math.max(0, Math.round((cut.endZ - cut.startZ) / pitch));
    const all: CutVertex[] = [];
    for (let i = 0; i < count; i++) {
        const cycleStart = cut.startZ + i * pitch;
        const period = cutPeriodVertices(cut, cycleStart, baseR);
        if (i === 0) {
            all.push(...period);
        } else {
            // 前周期の最後の peak と新周期の最初の peak は同位置のため重複を除去
            all.push(...period.slice(1));
        }
    }
    return all;
}
