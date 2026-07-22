import { createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ZipArchive } from 'archiver';
import type { CreatorProject, GenerationRun } from '@img3d/shared';
import { ProjectStore } from './store.js';

function reactWrapper(factoryName: string): string {
  return `import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { ${factoryName} } from './createObjectModel';

export function ObjectModel(props: { wireframe?: boolean }) {
  const model = useMemo(() => ${factoryName}({ wireframe: props.wireframe }), [props.wireframe]);
  useFrame((_, delta) => {
    const tick = model.userData.tick as ((delta: number, elapsed: number) => void) | undefined;
    if (tick) tick(delta, performance.now() / 1000);
  });
  useEffect(() => () => {
    const runtime = model.userData.sculptRuntime as { dispose?: () => void } | undefined;
    if (runtime?.dispose) runtime.dispose();
    else model.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        materials.forEach((material) => material.dispose());
      });
  }, [model]);
  return <primitive object={model} />;
}
`;
}

function vanillaExample(factoryName: string): string {
  return `import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ${factoryName} } from './src/createObjectModel';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(5, 3, 6);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 2));
const key = new THREE.DirectionalLight(0xffffff, 4);
key.position.set(4, 6, 5);
scene.add(key);
const model = ${factoryName}({ castShadow: true });
scene.add(model);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const elapsed = clock.getElapsedTime();
  const tick = model.userData.tick;
  if (typeof tick === 'function') tick(clock.getDelta(), elapsed);
  controls.update();
  renderer.render(scene, camera);
});
`;
}

function readme(project: CreatorProject, factoryName: string): string {
  return `# ${project.name} — Three.js model

This bundle was generated locally by Image-to-3D Creator. The model is a procedural approximation, not a manufacturing-grade scan.

## Install — vanilla Three.js

\`\`\`bash
npm install three
\`\`\`

Copy \`src/createObjectModel.ts\` into your project and call \`${factoryName}()\`. The factory returns a \`THREE.Group\`; add it to any Three.js scene. See \`vanilla-example.ts\` for camera, lighting, orbit controls, sizing, and the animation tick.

## Install — React Three Fiber

\`\`\`bash
npm install three react @react-three/fiber
\`\`\`

Import \`ObjectModel\` from \`src/ObjectModel.tsx\` inside a React Three Fiber \`Canvas\`.

## Runtime contract

Named parts, sockets, colliders, and future interaction anchors are exposed at \`root.userData.sculptRuntime\`. V1 does not attach click behavior or video screens.

Confirmed package text and decals are exposed under \`root.userData.sculptRuntime.labels\`. Local label assets are included in the \`assets/\` directory; no source video or full reference photograph is exported.

## Cleanup

Traverse the returned group and dispose geometries, materials, and textures when unmounting it. The React wrapper includes a basic cleanup example.

## Sizing and animation

Scale the returned group as one unit. If \`root.userData.tick\` exists, call it during your render loop with delta and elapsed seconds.
`;
}

async function factoryNameFromSource(source: string): Promise<string> {
  return source.match(/export\s+(?:default\s+)?function\s+(create[A-Za-z0-9_]+)/)?.[1]
    ?? source.match(/export\s+const\s+(create[A-Za-z0-9_]+)/)?.[1]
    ?? 'createObjectModel';
}

export async function buildProjectExport(store: ProjectStore, project: CreatorProject, run: GenerationRun): Promise<string> {
  if (run.status !== 'succeeded') throw new Error('Only successful runs can be exported.');
  const runDir = store.runDir(project.id, run.id);
  const workspace = resolve(runDir, 'workspace');
  const sourcePath = resolve(workspace, 'src/createModel.ts');
  const source = await readFile(sourcePath, 'utf8');
  const factoryName = await factoryNameFromSource(source);
  const exportDir = resolve(runDir, 'export');
  await rm(exportDir, { recursive: true, force: true });
  await mkdir(resolve(exportDir, 'src'), { recursive: true });
  await writeFile(resolve(exportDir, 'src/createObjectModel.ts'), source, 'utf8');
  await writeFile(resolve(exportDir, 'src/ObjectModel.tsx'), reactWrapper(factoryName), 'utf8');
  await writeFile(resolve(exportDir, 'vanilla-example.ts'), vanillaExample(factoryName), 'utf8');
  await writeFile(resolve(exportDir, 'README.md'), readme(project, factoryName), 'utf8');
  await writeFile(resolve(exportDir, 'package.json'), `${JSON.stringify({
    name: `${project.slug}-threejs-model`,
    private: true,
    type: 'module',
    peerDependencies: {
      three: '>=0.169.0',
      react: '>=18.0.0',
      '@react-three/fiber': '>=8.0.0',
    },
    peerDependenciesMeta: {
      react: { optional: true },
      '@react-three/fiber': { optional: true },
    },
  }, null, 2)}\n`, 'utf8');
  const specPath = resolve(workspace, 'object-sculpt-spec.json');
  if (await stat(specPath).then(() => true).catch(() => false)) {
    await writeFile(resolve(exportDir, 'object-sculpt-spec.json'), await readFile(specPath));
  }
  const labelEvidencePath = resolve(workspace, 'label-evidence.json');
  if (await stat(labelEvidencePath).then(() => true).catch(() => false)) {
    await writeFile(resolve(exportDir, 'label-evidence.json'), await readFile(labelEvidencePath));
  }
  const assetsPath = resolve(workspace, 'assets');
  if (await stat(assetsPath).then((entry) => entry.isDirectory()).catch(() => false)) {
    await cp(assetsPath, resolve(exportDir, 'assets'), { recursive: true });
  }

  const zipPath = resolve(runDir, `${project.slug}-threejs.zip`);
  await new Promise<void>((resolveArchive, rejectArchive) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolveArchive);
    output.on('error', rejectArchive);
    archive.on('error', rejectArchive);
    archive.pipe(output);
    archive.directory(exportDir, false);
    void archive.finalize();
  });
  return zipPath;
}
