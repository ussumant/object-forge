import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = resolve(moduleDirectory, '../../..');
export const DATA_DIR = resolve(process.env.IMG3D_DATA_DIR ?? resolve(ROOT_DIR, 'data'));
export const PROJECTS_DIR = resolve(DATA_DIR, 'projects');
export const VENDOR_PIPELINE_DIR = resolve(ROOT_DIR, 'vendor/img2threejs');
export const WEB_DIST_DIR = resolve(ROOT_DIR, 'apps/web/dist');
export const WORKSPACE_CAPTURE_SCRIPT = resolve(ROOT_DIR, 'apps/server/assets/capture-preview.mjs');
