'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useBarrelStore } from '@/lib/store/useBarrelStore';
import { generateProfile, generateBarrelGeometry } from '@/lib/math/generator';

export const Barrel = () => {
    const { length, maxDiameter, cuts, frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear } = useBarrelStore();

    // Debug log
    // console.log('Barrel Render:', length, maxDiameter, cuts.length);

    // const points = useMemo(() => {
    //     return generateProfile(length, maxDiameter, cuts, frontTaperLength, rearTaperLength);
    // }, [length, maxDiameter, cuts, frontTaperLength, rearTaperLength]);

    const geometry = useMemo(() => {
        const geom = generateBarrelGeometry(length, maxDiameter, cuts, frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear);

        // Rotate -90 deg around X to align with Z axis (standard depth).
        // Our generator made Y-axis aligned (Lathe style).
        geom.rotateX(-Math.PI / 2);

        // Center the geometry
        // Generator makes vertices from y=0 to y=-length (check generator logic).
        // Actually, my generator uses `vertices.push(-y)`. `y` goes 0 to length. So vertices go 0 to -length.
        // To center it: Translate Z by -length/2.
        // Original Z: 0 (Front) to length (Rear).
        // New Z: -length/2 (Front) to length/2 (Rear).
        geom.translate(0, 0, -length / 2);

        return geom;
    }, [length, maxDiameter, cuts, frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear]);

    return (
        <mesh geometry={geometry} castShadow receiveShadow>
            <meshStandardMaterial
                color="#D1D5DB" // zinc-300
                roughness={0.3}
                metalness={0.8}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
};
