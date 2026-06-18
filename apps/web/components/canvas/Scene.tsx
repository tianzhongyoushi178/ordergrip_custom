'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Text, Billboard } from '@react-three/drei';
import { Barrel } from './Barrel';
import { ErrorBoundary } from '../ErrorBoundary';
import { useBarrelStore } from '@/lib/store/useBarrelStore';
import { Suspense, useEffect, useState, useRef, type ComponentRef } from 'react';

// カメラ既定位置。チップ側(-Z)が画面の左手前に来る向き (-X,-Z 側の上方から見下ろす)。
// Canvas の初期 camera prop とリセットボタンの復帰先で共有し、両者を一致させる。
const DEFAULT_CAMERA_POSITION: readonly [number, number, number] = [-40, 30, -60];
// 真横ビュー。バレル長手 (Z軸) に直交する -X から見て全長シルエットを表示する。
// 既定アイソメと同じ -X 側に置き、チップ側を画面左に揃える。
const SIDE_CAMERA_POSITION: readonly [number, number, number] = [-85, 0, 0];

export const Scene = () => {
    const { length, cameraResetTrigger, cameraSideTrigger } = useBarrelStore();
    const [isMobile, setIsMobile] = useState(false);
    const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Reset Camera Effect — only fire when the user explicitly presses the
    // "視点をリセット" button (triggerCameraReset increments cameraResetTrigger).
    // 初回マウントは Canvas の camera prop が初期位置を設定するため不要。
    // isMobile を依存に入れるとブレークポイント跨ぎで意図せずカメラがリセット
    // されるため除外する。
    useEffect(() => {
        if (cameraResetTrigger === 0) return;
        if (controlsRef.current) {
            controlsRef.current.target.set(0, 0, 0);
            controlsRef.current.object.position.set(...DEFAULT_CAMERA_POSITION);
            controlsRef.current.update();
        }
    }, [cameraResetTrigger]);

    // Side View Effect — 「真横」ボタン押下時にバレル長手(Z軸)へ直交する真横へスナップ。
    // 初期値 0 のときは発火しない (cameraResetTrigger と同じガード)。
    useEffect(() => {
        if (cameraSideTrigger === 0) return;
        if (controlsRef.current) {
            controlsRef.current.target.set(0, 0, 0);
            controlsRef.current.object.position.set(...SIDE_CAMERA_POSITION);
            controlsRef.current.update();
        }
    }, [cameraSideTrigger]);

    const offset = 8; // mm gap from barrel end
    // ラベルは目印程度に。大きすぎるとバレル本体の視認を妨げるため抑えめ。
    const fontSize = isMobile ? 2.2 : 3;
    const labelY = isMobile ? 8 : 4; // Move labels higher on mobile

    return (
        <Canvas
            shadows
            // Adjusted camera to fit 40-50mm barrel + labels. Distance ~80-100 units.
            // On mobile, we might want to zoom out a bit more?
            camera={{ position: [...DEFAULT_CAMERA_POSITION], fov: 35 }}
            className="absolute inset-0 z-0"
            // preserveDrawingBuffer: スクリーンショット (canvas.toBlob) を可能にする。
            // 通常は性能向上のためフレーム描画後にバッファをクリアするが、Xシェアで
            // バレル画像をキャプチャするために保持する。
            gl={{ preserveDrawingBuffer: true }}
            // Three.js 標準シェーダーが Windows ANGLE (D3D11) でコンパイルされる際の
            // 浮動小数点精度警告 (X4122/X4008) を本番ビルドで抑制
            onCreated={({ gl }) => {
                if (typeof gl.debug === 'object' && gl.debug !== null) {
                    gl.debug.checkShaderErrors = false;
                }
            }}
        >
            {/* Environment は drei が外部CDNからHDRを実行時取得する。取得失敗で
                Canvas 全体が落ちないよう Suspense + ErrorBoundary で隔離する。
                失敗時は環境反射のみ消え、ambient/directional ライトでバレルは描画継続。 */}
            <Suspense fallback={null}>
                <ErrorBoundary fallback={null}>
                    <Environment preset="city" />
                </ErrorBoundary>
            </Suspense>
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 10]} intensity={1.5} castShadow />

            <group position={[0, 0, 0]}>
                <Barrel />

                {/* ラベル(drei Text)は troika が外部CDNからフォントを取得する。
                    取得失敗でシーンが落ちないよう Suspense + ErrorBoundary で隔離する。 */}
                <Suspense fallback={null}>
                  <ErrorBoundary fallback={null}>
                {/* Visual Markers - Front (Tip) */}
                {/* Fixed Geometry: Front is at -length/2 */}
                <group position={[0, 0, -length / 2 - offset]}>
                    <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
                        <Text
                            position={[0, labelY, 0]}
                            fontSize={fontSize}
                            color="#ffffff"
                            fillOpacity={0.6}
                            outlineColor="#000000"
                            outlineWidth="6%"
                            outlineOpacity={0.7}
                            outlineBlur="8%"
                            anchorX="center"
                            anchorY="middle"
                            renderOrder={1}
                            material-depthTest={false} // Always visible through objects
                        >
                            前 (チップ側)
                        </Text>
                    </Billboard>
                </group>

                {/* Visual Markers - Rear (Shaft) */}
                {/* Fixed Geometry: Rear is at +length/2 */}
                <group position={[0, 0, length / 2 + offset]}>
                    <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>

                        <Text
                            position={[0, labelY, 0]}
                            fontSize={fontSize}
                            color="#ffffff"
                            fillOpacity={0.6}
                            outlineColor="#000000"
                            outlineWidth="6%"
                            outlineOpacity={0.7}
                            outlineBlur="8%"
                            anchorX="center"
                            anchorY="middle"
                            renderOrder={1}
                            material-depthTest={false}
                        >
                            後 (シャフト側)
                        </Text>
                    </Billboard>
                </group>
                  </ErrorBoundary>
                </Suspense>

                {/* Axis Line/Floor Grid helper could be added if requested, but clean is better */}
            </group>

            <ContactShadows resolution={1024} scale={20} blur={1} opacity={0.5} far={10} color="#000000" />
            <OrbitControls
                ref={controlsRef}
                makeDefault
                target={[0, 0, 0]}
                // 慣性付きスムーズ回転
                enableDamping
                dampingFactor={0.12}
                // 回転速度（モバイルはやや遅め）
                rotateSpeed={isMobile ? 0.6 : 0.8}
                // パン速度・スクリーン空間パン（画面方向に直感的に移動）
                panSpeed={0.8}
                screenSpacePanning
                // ズーム制限（近すぎ/遠すぎ防止）
                minDistance={15}
                maxDistance={200}
                // 上下回転制限（裏返り防止）
                minPolarAngle={Math.PI * 0.05}
                maxPolarAngle={Math.PI * 0.95}
                // タッチ操作: 1本指=回転、2本指=パン＆ズーム
                touches={{ ONE: 0 /* ROTATE */, TWO: 2 /* DOLLY_PAN */ }}
            />
        </Canvas>
    );
};
