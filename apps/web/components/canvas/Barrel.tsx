'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useBarrelStore } from '@/lib/store/useBarrelStore';
import { generateBarrelGeometry } from '@/lib/math/generator';

/** 操作中カットのハイライトバンド */
const CutHighlight = ({ startZ, endZ, length, maxDiameter }: {
    startZ: number; endZ: number; length: number; maxDiameter: number;
}) => {
    const bandLength = endZ - startZ;
    const centerZ = (startZ + endZ) / 2 - length / 2; // centered coordinates
    const radius = maxDiameter / 2 + 0.3; // slightly larger than barrel

    return (
        <mesh position={[0, 0, centerZ]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[radius, radius, bandLength, 32, 1, true]} />
            <meshBasicMaterial
                color="#6366f1"
                transparent
                opacity={0.25}
                side={THREE.DoubleSide}
                depthWrite={false}
            />
        </mesh>
    );
};

export const Barrel = () => {
    const { length, maxDiameter, cuts, frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear, outline, frontEndShape, rearEndShape, activeCutId } = useBarrelStore();

    const geometry = useMemo(() => {
        const geom = generateBarrelGeometry(length, maxDiameter, cuts, frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear, outline, frontEndShape, rearEndShape);
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, 0, -length / 2);
        return geom;
    }, [length, maxDiameter, cuts, frontTaperLength, rearTaperLength, holeDepthFront, holeDepthRear, outline, frontEndShape, rearEndShape]);

    // 古いBufferGeometryのGPUバッファを解放する。スマホで連続スライダー操作中に
    // WebGLコンテキストが失われ、Canvasがremountして初期画面に戻る現象を防ぐ。
    useEffect(() => {
        return () => {
            geometry.dispose();
        };
    }, [geometry]);

    const activeCut = activeCutId ? cuts.find(c => c.id === activeCutId) : null;

    return (
        <group>
            <mesh geometry={geometry} castShadow receiveShadow>
                <meshStandardMaterial
                    color="#D1D5DB"
                    roughness={0.3}
                    metalness={0.8}
                    side={THREE.DoubleSide}
                />
            </mesh>
            {activeCut && (
                <CutHighlight
                    startZ={activeCut.startZ}
                    endZ={activeCut.endZ}
                    length={length}
                    maxDiameter={maxDiameter}
                />
            )}
        </group>
    );
};
