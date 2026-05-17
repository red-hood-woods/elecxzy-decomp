"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFileAtomic = writeFileAtomic;
exports.writeFileAtomicSync = writeFileAtomicSync;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
function generateTempPath(realTarget) {
    const dir = path_1.default.dirname(realTarget);
    const base = path_1.default.basename(realTarget);
    const suffix = `${process.pid}-${crypto_1.default.randomBytes(6).toString('hex')}`;
    return path_1.default.join(dir, `.${base}.tmp-${suffix}`);
}
function resolveRealTarget(targetPath) {
    try {
        const lst = fs_1.default.lstatSync(targetPath);
        if (lst.isSymbolicLink())
            return fs_1.default.realpathSync(targetPath);
    }
    catch (_a) {
        // Path does not exist yet (new file save) — write directly to it.
    }
    return targetPath;
}
function existingFileMode(realTarget) {
    try {
        return fs_1.default.statSync(realTarget).mode & 0o777;
    }
    catch (_a) {
        return null;
    }
}
function writeFileAtomic(targetPath_1, data_1) {
    return __awaiter(this, arguments, void 0, function* (targetPath, data, options = {}) {
        var _a, _b;
        const realTarget = resolveRealTarget(targetPath);
        const tmpPath = generateTempPath(realTarget);
        const mode = (_a = existingFileMode(realTarget)) !== null && _a !== void 0 ? _a : 0o666;
        let fd = null;
        try {
            fd = yield fs_1.default.promises.open(tmpPath, 'wx', mode);
            if (typeof data === 'string') {
                yield fd.writeFile(data, { encoding: (_b = options.encoding) !== null && _b !== void 0 ? _b : 'utf-8' });
            }
            else {
                yield fd.writeFile(data);
            }
            yield fd.sync();
            yield fd.close();
            fd = null;
            yield fs_1.default.promises.rename(tmpPath, realTarget);
        }
        catch (err) {
            if (fd) {
                try {
                    yield fd.close();
                }
                catch ( /* swallow */_c) { /* swallow */ }
            }
            try {
                yield fs_1.default.promises.unlink(tmpPath);
            }
            catch ( /* swallow */_d) { /* swallow */ }
            throw err;
        }
    });
}
function writeFileAtomicSync(targetPath, data, options = {}) {
    var _a, _b;
    const realTarget = resolveRealTarget(targetPath);
    const tmpPath = generateTempPath(realTarget);
    const mode = (_a = existingFileMode(realTarget)) !== null && _a !== void 0 ? _a : 0o666;
    let fd = null;
    try {
        fd = fs_1.default.openSync(tmpPath, 'wx', mode);
        if (typeof data === 'string') {
            fs_1.default.writeFileSync(fd, data, { encoding: (_b = options.encoding) !== null && _b !== void 0 ? _b : 'utf-8' });
        }
        else {
            fs_1.default.writeFileSync(fd, data);
        }
        fs_1.default.fsyncSync(fd);
        fs_1.default.closeSync(fd);
        fd = null;
        fs_1.default.renameSync(tmpPath, realTarget);
    }
    catch (err) {
        if (fd !== null) {
            try {
                fs_1.default.closeSync(fd);
            }
            catch ( /* swallow */_c) { /* swallow */ }
        }
        try {
            fs_1.default.unlinkSync(tmpPath);
        }
        catch ( /* swallow */_d) { /* swallow */ }
        throw err;
    }
}
