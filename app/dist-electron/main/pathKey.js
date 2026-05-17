"use strict";
/**
 * Main-process equivalent of src/utils/pathUtils.ts (`pathKey` / `pathsEqual`).
 *
 * Why this file exists:
 *   electron/tsconfig.json sets rootDir to "." (= electron/), so we cannot import
 *   directly from src/utils/pathUtils.ts. The renderer-side helper is the source
 *   of truth for the project's path-equality semantics; if you change behavior
 *   there, mirror it here.
 *
 * Semantics:
 *   - `win32`  → forward-slashed and lowercased (NTFS / FAT default)
 *   - `darwin` → forward-slashed and lowercased (APFS / HFS+ default)
 *   - others   → forward-slashed only (Linux et al. are case-sensitive)
 *
 * Use the exported key/equal helpers as comparison keys only — do not pass the
 * result to fs APIs as a real path, because casing/separator transformations
 * are intentionally lossy here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pathsEqual = exports.pathKey = void 0;
const IS_CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';
const pathKey = (p) => {
    if (!p)
        return '';
    const slashed = p.replace(/\\/g, '/');
    return IS_CASE_INSENSITIVE_FS ? slashed.toLowerCase() : slashed;
};
exports.pathKey = pathKey;
const pathsEqual = (a, b) => {
    if (!a || !b)
        return false;
    return (0, exports.pathKey)(a) === (0, exports.pathKey)(b);
};
exports.pathsEqual = pathsEqual;
