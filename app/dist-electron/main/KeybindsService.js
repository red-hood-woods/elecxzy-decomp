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
exports.keybindsService = exports.KeybindsService = void 0;
exports.registerKeybindsHandlers = registerKeybindsHandlers;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const atomicWrite_1 = require("./atomicWrite");
const KEYBINDS_FILE = 'keybinds.json';
class KeybindsService {
    constructor() {
        this.filePath = '';
        this.initialized = false;
    }
    ensurePath() {
        if (!this.initialized) {
            this.filePath = path_1.default.join(electron_1.app.getPath('userData'), KEYBINDS_FILE);
            this.initialized = true;
        }
    }
    getPath() {
        this.ensurePath();
        return this.filePath;
    }
    /**
     * 生のテキスト内容を返す。パース・検証はレンダラ側で行う。
     * - 存在しない場合は { exists: false, content: null, error: null }
     * - 読み込み失敗（権限エラー等）は { exists: false, content: null, error: <msg> }
     * 仕様: ファイルが無くてもエラーにはしない（呼び出し側で「変更なし」を選択する）。
     */
    getRaw() {
        return __awaiter(this, void 0, void 0, function* () {
            this.ensurePath();
            try {
                const data = yield fs_1.promises.readFile(this.filePath, 'utf-8');
                return { exists: true, content: data, error: null };
            }
            catch (e) {
                if ((e === null || e === void 0 ? void 0 : e.code) === 'ENOENT') {
                    return { exists: false, content: null, error: null };
                }
                const msg = e instanceof Error ? e.message : String(e);
                console.error('Failed to read keybinds.json:', msg);
                return { exists: false, content: null, error: msg };
            }
        });
    }
    /**
     * keybinds.json が無ければ "{}" を書き出す。存在する場合は内容に関わらず触らない。
     * （不正な JSON が入っていても上書きしない仕様）。
     */
    ensureExists() {
        return __awaiter(this, void 0, void 0, function* () {
            this.ensurePath();
            try {
                yield fs_1.promises.access(this.filePath);
                return { created: false, error: null };
            }
            catch (e) {
                if ((e === null || e === void 0 ? void 0 : e.code) === 'ENOENT') {
                    try {
                        yield (0, atomicWrite_1.writeFileAtomic)(this.filePath, '{}\n');
                        return { created: true, error: null };
                    }
                    catch (writeErr) {
                        const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
                        console.error('Failed to create keybinds.json:', msg);
                        return { created: false, error: msg };
                    }
                }
                const msg = e instanceof Error ? e.message : String(e);
                console.error('Failed to access keybinds.json:', msg);
                return { created: false, error: msg };
            }
        });
    }
}
exports.KeybindsService = KeybindsService;
exports.keybindsService = new KeybindsService();
function registerKeybindsHandlers() {
    electron_1.ipcMain.handle('keybinds:get', () => exports.keybindsService.getRaw());
    electron_1.ipcMain.handle('keybinds:getPath', () => exports.keybindsService.getPath());
    electron_1.ipcMain.handle('keybinds:ensure', () => exports.keybindsService.ensureExists());
}
