'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Text } from '@react-three/drei';
import { Barrel } from './Barrel';

export const Scene = () => {
    return (
        <Canvas
            shadows
            // Adjusted camera to fit 40-50mm barrel + labels. Distance ~80-100 units.
            camera={{ position: [40, 30, 60], fov: 35 }}
            className="absolute inset-0 z-0"
        >
            <Environment preset="city" />
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 10]} intensity={1.5} castShadow />

            <group position={[0, 0, 0]}>
                <Barrel />

                {/* Visual Markers - Front (Tip) */}
                <group position={[0, 0, 32]}>
                    <Text
                        position={[0, 4, 0]}
                        rotation={[0, Math.PI / 2, 0]}
                        fontSize={4}
                        color="#333"
                        anchorX="center"
                        anchorY="middle"
                    >
                        FRONT (Tip)
                    </Text>
                    {/* Metric line or arrow could go here */}
                </group>

                {/* Visual Markers - Rear (Shaft) */}
                <group position={[0, 0, -32]}>
                    <Text
                        position={[0, 4, 0]}
                        rotation={[0, Math.PI / 2, 0]}
                        fontSize={4}
                        color="#333"
                        anchorX="center"
                        anchorY="middle"
                    >
                        REAR (Shaft)
                    </Text>
                </group>

                {/* Axis Line/Floor Grid helper could be added if requested, but clean is better */}
            </group>

            <ContactShadows resolution={1024} scale={20} blur={1} opacity={0.5} far={10} color="#000000" />
            <OrbitControls makeDefault />
        </Canvas>
    );
};
