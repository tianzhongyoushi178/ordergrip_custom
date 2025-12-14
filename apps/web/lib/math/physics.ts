import * as THREE from 'three';

export interface PhysicsData {
    volume: number; // cm3
    weight: number; // g
    centerOfGravity: number; // mm from front (z=0)
}

export const calculatePhysics = (points: THREE.Vector2[], density: number, holeDepthFront: number = 0, holeDepthRear: number = 0): PhysicsData => {
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

        // Conical frustum volume
        // V = (pi * h / 3) * (r1^2 + r1*r2 + r2^2)
        const dv = (Math.PI * h / 3) * (r1 * r1 + r1 * r2 + r2 * r2);

        // Centroid of frustum (z-coordinate)
        // Formula for centroid of conical frustum relative to base (z1)
        const numerator = r1 * r1 + 2 * r1 * r2 + 3 * r2 * r2;
        const denominator = 4 * (r1 * r1 + r1 * r2 + r2 * r2);
        const relativeZc = h * (numerator / denominator);

        const zc = z1 + relativeZc;

        volume += dv;
        momentZ += dv * zc;
    }

    // 2BA Hole Radius approx 2.1mm -> 0.21cm
    const holeRadCm = 0.21;
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

    const finalVolume = volume - frontHoleVol - rearHoleVol;
    const finalMoment = momentZ - (frontHoleVol * frontHoleCoG) - (rearHoleVol * rearHoleCoG);

    const weight = Math.max(0, finalVolume * density);
    const cogCm = finalVolume > 0 ? finalMoment / finalVolume : 0;
    const centerOfGravity = cogCm * 10; // convert back to mm

    return { volume: finalVolume, weight, centerOfGravity };
};
