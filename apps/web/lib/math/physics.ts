import * as THREE from 'three';

export const HOLE_RADIUS_MM = 2.1;
export const HOLE_RADIUS_CM = HOLE_RADIUS_MM / 10;

export interface PhysicsData {
    volume: number; // cm3
    weight: number; // g
    centerOfGravity: number; // mm from front (z=0)
}

/**
 * @param areaFactorAt フラスタム中点の Z 位置(mm)を受け取り、断面積の補正係数を返す。
 *   真円=1、正多角形は < 1 (頂点=半径の正 N 角形なら N·sin(2π/N)/(2π))。区間ごとに
 *   多角形/円を切り替えられるよう関数で受ける。本体(中実部)のみに掛かる(穴は円形)。
 * @param knurlAreaAt フラスタム中点の Z 位置(mm)と半径(cm)を受け取り、ローレット/スパイラル
 *   (周方向の溝)が除去する断面積(cm²)を返す。多角形係数とは独立した絶対面積として円錐台体積から減算する。
 *   生成側 (generator.makeKnurlAreaRemovedFn) で「上面のみ」適用と整合したモデルを構築する。
 */
export const calculatePhysics = (points: THREE.Vector2[], density: number, holeDepthFront: number = 0, holeDepthRear: number = 0, areaFactorAt: (zMid: number) => number = () => 1, knurlAreaAt: (zMidMm: number, rMidCm: number) => number = () => 0): PhysicsData => {
    let volume = 0;
    let momentZ = 0;

    // Integrate segments
    // Points are (r, z) where r, z are in mm.
    // We need volume in cm3, so we convert mm to cm.
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        const r1 = p1.x / 10; // convert mm to cm
        const r2 = p2.x / 10;
        const z1 = p1.y / 10;
        const z2 = p2.y / 10;

        const h = z2 - z1;
        if (h <= 0.000001) continue;

        // Conical frustum volume (× 断面積係数で多角形断面に対応。z 方向重心は不変)
        // V = (pi * h / 3) * (r1^2 + r1*r2 + r2^2)
        // 区間判定はゾーン境界(mm)で行うため、中点 z は mm 値(p1.y/p2.y)で渡す。
        const zMidMm = (p1.y + p2.y) / 2;
        const dv = (Math.PI * h / 3) * (r1 * r1 + r1 * r2 + r2 * r2) * areaFactorAt(zMidMm);

        // ローレット/スパイラル(周方向の溝)が外周面から除去する体積を減算する。
        // 微小区間(0.1mm刻み)なので、中点半径での除去断面積 × 区間長 の角柱で近似。
        const rMidCm = (r1 + r2) / 2;
        const dvKnurl = knurlAreaAt(zMidMm, rMidCm) * h;
        const dvNet = Math.max(0, dv - dvKnurl);

        // Centroid of frustum (z-coordinate)
        // Formula for centroid of conical frustum relative to base (z1)
        const numerator = r1 * r1 + 2 * r1 * r2 + 3 * r2 * r2;
        const denominator = 4 * (r1 * r1 + r1 * r2 + r2 * r2);
        const relativeZc = h * (numerator / denominator);

        const zc = z1 + relativeZc;

        volume += dvNet;
        momentZ += dvNet * zc;
    }

    const holeRadCm = HOLE_RADIUS_CM;
    const holeArea = Math.PI * holeRadCm * holeRadCm;

    // Front Hole Volume
    // Cylinder from z=0 to z=holeDepthFront/10
    const frontHoleLenCm = (holeDepthFront || 0) / 10;
    const frontHoleVol = holeArea * frontHoleLenCm;
    const frontHoleCoG = frontHoleLenCm / 2; // relative to z=0

    // Rear Hole Volume
    // Cylinder from z=(Length-holeDepthRear)/10 to z=Length/10
    // Total Length in cm? We can infer from points or just expect user to pass it? 
    // Points[last].y is the length.
    const lengthCm = points[points.length - 1].y / 10;
    const rearHoleLenCm = (holeDepthRear || 0) / 10;
    const rearHoleVol = holeArea * rearHoleLenCm;
    const rearHoleCoG = lengthCm - (rearHoleLenCm / 2);

    // Subtract Volumes
    // New Volume = V_solid - V_front - V_rear
    // New Moment = M_solid - (V_front * C_front) - (V_rear * C_rear)

    const finalVolume = Math.max(0, volume - frontHoleVol - rearHoleVol);
    const finalMoment = momentZ - (frontHoleVol * frontHoleCoG) - (rearHoleVol * rearHoleCoG);

    const weight = Math.max(0, finalVolume * density);
    const cogCm = finalVolume > 0 ? finalMoment / finalVolume : 0;
    const centerOfGravity = cogCm * 10; // convert back to mm

    return { volume: finalVolume, weight, centerOfGravity };
};
