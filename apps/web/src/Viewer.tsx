import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Center, ContactShadows, Float, Grid, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

type ViewerProps = {
  modelUrl?: string;
  wireframe: boolean;
  background: 'graphite' | 'bone' | 'studio';
  resetKey: number;
};

function StarterObject() {
  const bodyMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#d2d3c9',
    roughness: 0.3,
    metalness: 0.28,
    clearcoat: 0.55,
    clearcoatRoughness: 0.16,
  }), []);
  const darkMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#171914', roughness: 0.42, metalness: 0.4 }), []);
  const accentMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ff5b2d', roughness: 0.28, metalness: 0.15 }), []);
  return (
    <Float speed={1.2} rotationIntensity={0.08} floatIntensity={0.18}>
      <group rotation={[0.08, -0.38, 0]}>
        <RoundedBox args={[3.2, 1.9, 1.3]} radius={0.16} smoothness={5} material={bodyMaterial} castShadow />
        <mesh position={[0.42, 0.08, 0.79]} rotation={[Math.PI / 2, 0, 0]} material={darkMaterial} castShadow>
          <cylinderGeometry args={[0.82, 0.7, 0.35, 64]} />
        </mesh>
        <mesh position={[0.42, 0.08, 1.02]} rotation={[Math.PI / 2, 0, 0]} material={bodyMaterial} castShadow>
          <cylinderGeometry args={[0.53, 0.46, 0.4, 64]} />
        </mesh>
        <RoundedBox args={[0.72, 1.52, 0.48]} radius={0.12} smoothness={4} position={[-1.38, -0.04, 0.44]} rotation={[0, 0, -0.04]} material={darkMaterial} castShadow />
        <mesh position={[-0.86, 1.02, 0.29]} material={accentMaterial} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.11, 24]} />
        </mesh>
      </group>
    </Float>
  );
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    materials.forEach((material) => material.dispose());
  });
}

function GeneratedModel({ url, wireframe }: { url: string; wireframe: boolean }) {
  const [model, setModel] = useState<THREE.Object3D>();
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let loaded: THREE.Object3D | undefined;
    setError('');
    setModel(undefined);
    (globalThis as typeof globalThis & { __IMG3D_THREE__?: typeof THREE }).__IMG3D_THREE__ = THREE;
    void import(/* @vite-ignore */ url)
      .then((module: Record<string, unknown>) => {
        const factory = Object.entries(module).find(([key, value]) => key.startsWith('create') && typeof value === 'function')?.[1];
        if (typeof factory !== 'function') throw new Error('The preview bundle does not export a create… factory.');
        loaded = (factory as (options: { castShadow: boolean }) => THREE.Object3D)({ castShadow: true });
        if (alive) setModel(loaded);
      })
      .catch((reason: unknown) => alive && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      alive = false;
      if (loaded) disposeObject(loaded);
    };
  }, [url]);

  useEffect(() => {
    model?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      materials.forEach((material) => {
        if ('wireframe' in material) (material as THREE.MeshStandardMaterial).wireframe = wireframe;
        material.needsUpdate = true;
      });
    });
  }, [model, wireframe]);

  useFrame((_, delta) => {
    const tick = model?.userData.tick;
    if (typeof tick === 'function') tick(delta, performance.now() / 1_000);
  });

  if (error) return <StarterObject />;
  if (!model) return null;
  return <Center><primitive object={model} /></Center>;
}

const backgroundColors = {
  graphite: '#242720',
  bone: '#d8d3c7',
  studio: '#879078',
};

export function Viewer({ modelUrl, wireframe, background, resetKey }: ViewerProps) {
  return (
    <div className="viewer-canvas" data-testid="viewer-canvas">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 2]}
        camera={{ position: [5.4, 3.2, 6.4], fov: 35, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <color attach="background" args={[backgroundColors[background]]} />
        <fog attach="fog" args={[backgroundColors[background], 9, 17]} />
        <ambientLight intensity={0.72} />
        <directionalLight castShadow intensity={4.2} position={[4, 7, 5]} shadow-mapSize={[2048, 2048]} />
        <directionalLight intensity={1.5} color="#c8dbff" position={[-4, 2, 3]} />
        <directionalLight intensity={1.8} color="#ffd4b8" position={[2, 4, -5]} />
        <Suspense fallback={null}>
          {modelUrl ? <GeneratedModel url={modelUrl} wireframe={wireframe} /> : <StarterObject />}
        </Suspense>
        <ContactShadows position={[0, -1.35, 0]} opacity={0.45} scale={11} blur={2.8} far={5} color="#0f100d" />
        <Grid
          position={[0, -1.34, 0]}
          infiniteGrid
          sectionColor="#f66b3b"
          cellColor="#55594e"
          sectionSize={2}
          cellSize={0.5}
          fadeDistance={13}
          fadeStrength={1.5}
        />
        <OrbitControls key={resetKey} makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={12} target={[0, 0, 0]} />
      </Canvas>
      {!modelUrl && (
        <div className="viewer-empty-note">
          <span>Reference instrument</span>
          <strong>Your first draft will replace this study object.</strong>
        </div>
      )}
    </div>
  );
}
