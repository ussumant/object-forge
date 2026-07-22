import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { scanGeneratedSource, validateAndBundleModel } from './security.js';

describe('scanGeneratedSource', () => {
  it('accepts a code-only Three.js factory', () => {
    const source = `
      import * as THREE from 'three';
      export function createClockModel() {
        const root = new THREE.Group();
        root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
        return root;
      }
    `;
    expect(scanGeneratedSource(source)).toEqual([]);
  });

  it('accepts runtime metadata named node and ignores prose in block comments', () => {
    const source = `
      import * as THREE from 'three';
      /** This comment may discuss node:fs and process.env without executing them. */
      export function createMetadataModel() {
        const root = new THREE.Group();
        root.userData.socket = { node: 'screen-pivot' };
        return root;
      }
    `;
    expect(scanGeneratedSource(source)).toEqual([]);
  });

  it.each([
    ["fetch('/secret')", 'network calls'],
    ["import('other-package')", 'dynamic imports'],
    ["import fs from 'node:fs'", 'Node.js modules'],
    ["const cwd = process.cwd()", 'Node.js process APIs'],
    ["const bytes = Buffer.from('x')", 'Node.js globals'],
    ["const fs = require('fs')", 'CommonJS'],
    ["import thing from 'other-package'", 'is not allowed'],
    ["const url = 'https://example.com/model.glb'", 'external URL'],
    ["new Function('return 1')", 'dynamic code'],
  ])('rejects %s', (line, expected) => {
    const violations = scanGeneratedSource(`import * as THREE from 'three';\n${line}`);
    expect(violations.some((item) => item.message.includes(expected))).toBe(true);
  });

  it('bundles an approved local label asset as self-contained data', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'img3d-label-security-'));
    try {
      await mkdir(resolve(directory, 'src'), { recursive: true });
      await mkdir(resolve(directory, 'assets/labels'), { recursive: true });
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#1674ba' } })
        .png().toFile(resolve(directory, 'assets/labels/label.png'));
      const entry = resolve(directory, 'src/createModel.ts');
      await writeFile(entry, `import * as THREE from 'three';
import labelUrl from '../assets/labels/label.png';
export function createLabelModel() {
  const root = new THREE.Group();
  root.userData.labelUrl = labelUrl;
  return root;
}\n`);
      const output = resolve(directory, 'model.js');
      await validateAndBundleModel(entry, output);
      const bundled = await import('node:fs/promises').then(({ readFile }) => readFile(output, 'utf8'));
      expect(bundled).toContain('data:image/png;base64');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
