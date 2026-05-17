"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFileTreeHandler = registerFileTreeHandler;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let GetFileAttributesW = null;
if (process.platform === 'win32') {
    try {
        const koffi = require('koffi');
        const kernel32 = koffi.load('kernel32.dll');
        GetFileAttributesW = kernel32.func('uint32 __stdcall GetFileAttributesW(const char16_t* lpFileName)');
    }
    catch (e) {
        console.warn('Failed to load kernel32.dll with koffi:', e);
    }
}
function isHiddenOrSystemOnWindows(filePath) {
    if (process.platform !== 'win32' || !GetFileAttributesW)
        return false;
    try {
        const attr = GetFileAttributesW(filePath);
        if (attr === 0xFFFFFFFF)
            return false; // INVALID_FILE_ATTRIBUTES
        const FILE_ATTRIBUTE_HIDDEN = 0x2;
        const FILE_ATTRIBUTE_SYSTEM = 0x4;
        return (attr & FILE_ATTRIBUTE_HIDDEN) !== 0 || (attr & FILE_ATTRIBUTE_SYSTEM) !== 0;
    }
    catch (e) {
        return false;
    }
}
function registerFileTreeHandler() {
    electron_1.ipcMain.handle('read-sidebar-tree', (event, dirPath) => __awaiter(this, void 0, void 0, function* () {
        try {
            // 【修正】Windows用の仮想ドライブ一覧ルート（非同期・並行処理）
            if (dirPath === '::DRIVES::') {
                const promises = [];
                // AからZまでのドライブレターを並行してチェック
                for (let i = 65; i <= 90; i++) {
                    const drive = String.fromCharCode(i) + ':\\';
                    promises.push(fs.promises.access(drive, fs.constants.R_OK)
                        .then(() => ({
                        name: drive,
                        isDirectory: true,
                        path: drive
                    })));
                }
                // 全てのプロミスが解決（または拒否）されるのを待つ
                const results = yield Promise.allSettled(promises);
                // 成功（アクセス可能）だったドライブのみを抽出
                const drives = results
                    .filter((res) => res.status === 'fulfilled')
                    .map(res => res.value);
                return drives;
            }
            // ディレクトリの存在確認（非同期）
            try {
                const stat = yield fs.promises.stat(dirPath);
                if (!stat.isDirectory())
                    return [];
            }
            catch (_a) {
                return [];
            }
            const dirents = yield fs.promises.readdir(dirPath, { withFileTypes: true });
            const items = yield Promise.all(dirents.map((dirent) => __awaiter(this, void 0, void 0, function* () {
                const fullPath = path.join(dirPath, dirent.name);
                let isDirectory = dirent.isDirectory();
                // Symlink handling
                if (!isDirectory && dirent.isSymbolicLink()) {
                    try {
                        const realPath = yield fs.promises.realpath(fullPath);
                        const targetStat = yield fs.promises.stat(realPath);
                        isDirectory = targetStat.isDirectory();
                    }
                    catch (e) {
                        // Ignore broken links
                    }
                }
                return {
                    name: dirent.name,
                    isDirectory: isDirectory,
                    path: fullPath
                };
            })));
            // Filter out hidden/system files on Windows to match Explorer
            const visibleItems = items.filter(item => !isHiddenOrSystemOnWindows(item.path));
            // Sorting: Folders first, Files second. Inside each, alphabetical case-insensitive.
            visibleItems.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory)
                    return -1;
                if (!a.isDirectory && b.isDirectory)
                    return 1;
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });
            return visibleItems;
        }
        catch (e) {
            // Silence EPERM/EACCES errors for restricted folders like $RECYCLE.BIN
            if (e && e.code !== 'EPERM' && e.code !== 'EACCES') {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('API [read-sidebar-tree] error:', msg);
            }
            return [];
        }
    }));
    electron_1.ipcMain.handle('delete-item', (event, itemPath) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield electron_1.shell.trashItem(itemPath);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    }));
    electron_1.ipcMain.handle('create-new-file', (event, filePath) => __awaiter(this, void 0, void 0, function* () {
        try {
            const fileName = path.basename(filePath);
            const invalidChars = /[<>:"/\\|?*]/;
            if (invalidChars.test(fileName)) {
                return { success: false, error: 'Invalid characters in filename' };
            }
            if (fs.existsSync(filePath)) {
                return { success: false, error: 'File already exists' };
            }
            // Ensure parent directory exists
            const parentDir = path.dirname(filePath);
            if (!fs.existsSync(parentDir)) {
                yield fs.promises.mkdir(parentDir, { recursive: true });
            }
            yield fs.promises.writeFile(filePath, '');
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    }));
    electron_1.ipcMain.handle('create-new-directory', (event, dirPath) => __awaiter(this, void 0, void 0, function* () {
        try {
            const dirName = path.basename(dirPath);
            const invalidChars = /[<>:"/\\|?*]/;
            if (invalidChars.test(dirName)) {
                return { success: false, error: 'Invalid characters in folder name' };
            }
            if (fs.existsSync(dirPath)) {
                return { success: false, error: 'Folder already exists' };
            }
            yield fs.promises.mkdir(dirPath, { recursive: true });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    }));
    electron_1.ipcMain.handle('rename-item', (event, oldPath, newPath) => __awaiter(this, void 0, void 0, function* () {
        try {
            const newName = path.basename(newPath);
            const invalidChars = /[<>:"/\\|?*]/;
            if (invalidChars.test(newName)) {
                return { success: false, error: 'Invalid characters in name' };
            }
            if (oldPath === newPath) {
                return { success: true };
            }
            // 🚀 大文字小文字だけが違うリネーム（Windows / macOS）では「同じファイル」と扱われるため、
            //    同名衝突チェックをスキップして fs.rename に直接渡す（Windows は casing-only rename を
            //    特別に許可、macOS の APFS / HFS+ も同様）。
            //    Linux など case-sensitive ファイルシステムでは Foo.md と foo.md は別ファイルなので、
            //    casing が違ってもスキップせず通常通り存在チェックを行う。これを怠ると、
            //    既存の foo.md を Foo.md からのリネームで上書きしてしまう恐れがある。
            const isCaseInsensitiveOS = process.platform === 'win32' || process.platform === 'darwin';
            const isCaseOnlyChange = isCaseInsensitiveOS && oldPath.toLowerCase() === newPath.toLowerCase();
            if (!isCaseOnlyChange && fs.existsSync(newPath)) {
                return { success: false, error: 'Target already exists' };
            }
            yield fs.promises.rename(oldPath, newPath);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    }));
}
