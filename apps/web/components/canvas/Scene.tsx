'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Text } from '@react-three/drei';
import { Barrel } from './Barrel';

export const Scene = () => {
    return (
        <Canvas
            shadows
            camera={{ position: [8, 5, 8], fov: 40 }}
            className="absolute inset-0 z-0"
        >
            <Environment preset="city" />
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 10]} intensity={1.5} castShadow />

            <group position={[0, 0, 0]}>
                <Barrel />
                {/* Visual Markers */}
                <Text
                    position={[0, 0, 35]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    fontSize={2}
                    color="#666"
                >
                    FRONT (Tip)
                </Text>
                <Text
                    position={[0, 0, -35]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    fontSize={2}
                    color="#666"
                >
                    REAR (Shaft)
                </Text>
            </group>

            <ContactShadows resolution={1024} scale={20} blur={1} opacity={0.5} far={10} color="#000000" />
            <OrbitControls makeDefault />
        </Canvas>
    );
};
