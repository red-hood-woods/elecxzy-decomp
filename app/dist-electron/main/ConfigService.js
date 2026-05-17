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
exports.configService = exports.ConfigService = void 0;
exports.registerConfigHandlers = registerConfigHandlers;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const fs_2 = require("fs");
const atomicWrite_1 = require("./atomicWrite");
const CONFIG_FILE = 'config.json';
const DEFAULT_CONFIG = {
    fontSize: 14,
    fontFamily: '"JetBrains Mono", "Noto Sans JP", "BIZ UDGothic", "Meiryo", "Yu Gothic", Consolas, monospace',
    currentDirectory: '',
    clipboardIntegration: true,
    autoSave: true,
    autoSaveInterval: 5,
    autoRevertClean: true,
    caseSensitiveSearch: false,
    recentFiles: [],
    maxUndoLimit: 100,
    tabWidth: 4,
    wrapColumn: 70,
    autoFillMode: false,
    lineNumberMode: false,
    killRingMax: 60,
    cursorVfx: 'off',
    smoothCursor: false,
    showMacroVfx: false,
    displayDateTimeMode: false,
    displayDateTimeFormat: 'YYYY/MM/DD HH:mm',
    mcpAllowedDirectories: []
};
class ConfigService {
    constructor() {
        this.configPath = '';
        this.config = DEFAULT_CONFIG;
        this.initialized = false;
        this.loadError = null;
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.initialized)
                return;
            this.configPath = path_1.default.join(electron_1.app.getPath('userData'), CONFIG_FILE);
            this.config = yield this.loadAsync();
            this.initialized = true;
        });
    }
    ensureInitialized() {
        if (!this.initialized) {
            this.configPath = path_1.default.join(electron_1.app.getPath('userData'), CONFIG_FILE);
            this.config = this.loadSync();
            this.initialized = true;
        }
    }
    loadAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                try {
                    const data = yield fs_2.promises.readFile(this.configPath, 'utf-8');
                    this.loadError = null;
                    return Object.assign(Object.assign({}, DEFAULT_CONFIG), JSON.parse(data));
                }
                catch (e) {
                    if (e.code === 'ENOENT') {
                        // 初回起動時の default 書き出しも atomic 化 (saveSync / save / persist と同じ方式)。
                        // 書き込み中の電源断で半端な JSON が残っても、次回起動時に default で再生成される
                        // が、整合性のため書き出し自体を atomic にしておく。
                        yield (0, atomicWrite_1.writeFileAtomic)(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
                        this.loadError = null;
                        return DEFAULT_CONFIG;
                    }
                    throw e;
                }
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('Failed to load config:', msg);
                this.loadError = `config.json: ${msg}`;
                return DEFAULT_CONFIG;
            }
        });
    }
    loadSync() {
        try {
            if (fs_1.default.existsSync(this.configPath)) {
                const data = fs_1.default.readFileSync(this.configPath, 'utf-8');
                this.loadError = null;
                return Object.assign(Object.assign({}, DEFAULT_CONFIG), JSON.parse(data));
            }
            else {
                this.saveSync(DEFAULT_CONFIG);
                this.loadError = null;
                return DEFAULT_CONFIG;
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to load config:', msg);
            this.loadError = `config.json: ${msg}`;
            return DEFAULT_CONFIG;
        }
    }
    saveSync(config) {
        try {
            (0, atomicWrite_1.writeFileAtomicSync)(this.configPath, JSON.stringify(config, null, 2));
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to save default config:', msg);
        }
    }
    save(newConfig) {
        this.ensureInitialized();
        // ディスク上の最新状態を読み込む（手動編集を尊重するため）
        let currentOnDisk = {};
        try {
            if (fs_1.default.existsSync(this.configPath)) {
                const data = fs_1.default.readFileSync(this.configPath, 'utf-8');
                currentOnDisk = JSON.parse(data);
            }
        }
        catch (e) {
            // 解析失敗時はメモリ上の現在の値をベースにする
            currentOnDisk = Object.assign({}, this.config);
        }
        const merged = Object.assign(Object.assign({}, currentOnDisk), newConfig);
        // メモリ上の状態を更新（デフォルト補完済み）
        this.config = Object.assign(Object.assign({}, DEFAULT_CONFIG), merged);
        try {
            (0, atomicWrite_1.writeFileAtomicSync)(this.configPath, JSON.stringify(merged, null, 2));
            return true;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to save config:', msg);
            return false;
        }
    }
    get() {
        this.ensureInitialized();
        if (this.loadError) {
            return Object.assign(Object.assign({}, this.config), { _loadError: this.loadError });
        }
        return this.config;
    }
    /**
     * 各値がなければデフォルト値を出力する仕様に基づき、
     * ファイルに不足している項目のみをデフォルト値で補完して書き出す。
     * 既存の項目は一切上書きしない。
     */
    persist() {
        if (!this.initialized)
            return;
        try {
            let currentOnDisk = {};
            if (fs_1.default.existsSync(this.configPath)) {
                const data = fs_1.default.readFileSync(this.configPath, 'utf-8');
                currentOnDisk = JSON.parse(data);
            }
            // 補完処理：デフォルト値をベースに、ディスクの内容を上書き（ディスク優先）
            const completed = Object.assign(Object.assign({}, DEFAULT_CONFIG), currentOnDisk);
            (0, atomicWrite_1.writeFileAtomicSync)(this.configPath, JSON.stringify(completed, null, 2));
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to persist config on exit:', msg);
        }
    }
    getPath() {
        this.ensureInitialized();
        return this.configPath;
    }
}
exports.ConfigService = ConfigService;
exports.configService = new ConfigService();
function registerConfigHandlers() {
    electron_1.ipcMain.handle('config:get', () => exports.configService.get());
    electron_1.ipcMain.handle('config:getPath', () => exports.configService.getPath());
    electron_1.ipcMain.handle('config:save', (_, newConfig) => exports.configService.save(newConfig));
}
