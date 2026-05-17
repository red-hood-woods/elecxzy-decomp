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
Object.defineProperty(exports, "__esModule", { value: true });
exports.colorConfigService = exports.ColorConfigService = void 0;
exports.registerColorHandlers = registerColorHandlers;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
const atomicWrite_1 = require("./atomicWrite");
const defaultTheme = {
    titleBarBackground: '#0EA5E9',
    titleBarForeground: '#ffffff',
    editorBackground: '#ffffff',
    editorForeground: '#000000',
    editorSelection: '#add8e6',
    modelineBackground: '#0EA5E9',
    modelineForeground: '#ffffff',
    minibufferBackground: '#ffffff',
    minibufferForeground: '#000000',
    scrollbarForeground: '#000000',
};
class ColorConfigService {
    constructor() {
        this.configPath = '';
        this.config = defaultTheme;
        this.initialized = false;
        this.loadError = null;
    }
    ensureInitialized() {
        if (!this.initialized) {
            const userDataPath = electron_1.app.getPath('userData');
            this.configPath = path.join(userDataPath, 'color-config.json');
            this.config = this.load();
            this.initialized = true;
        }
    }
    load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8');
                const parsed = JSON.parse(data);
                this.loadError = null;
                if (parsed && typeof parsed === 'object') {
                    return Object.assign(Object.assign({}, defaultTheme), parsed);
                }
                return defaultTheme;
            }
            else {
                this.saveSync(defaultTheme);
                this.loadError = null;
                return defaultTheme;
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to load color config:', msg);
            this.loadError = `color-config.json: ${msg}`;
            return defaultTheme;
        }
    }
    saveSync(config) {
        try {
            (0, atomicWrite_1.writeFileAtomicSync)(this.configPath, JSON.stringify(config, null, 4), { encoding: 'utf-8' });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to save color config:', msg);
        }
    }
    getColorConfig() {
        this.ensureInitialized();
        if (this.loadError) {
            return Object.assign(Object.assign({}, this.config), { _loadError: this.loadError });
        }
        return this.config;
    }
    saveColorConfig(newConfig) {
        this.ensureInitialized();
        // ディスク上の最新状態を読み込む（手動編集を尊重するため）
        let currentOnDisk = {};
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8');
                currentOnDisk = JSON.parse(data);
            }
        }
        catch (e) {
            currentOnDisk = Object.assign({}, this.config);
        }
        const merged = Object.assign(Object.assign({}, currentOnDisk), newConfig);
        // メモリ上の状態を更新（デフォルト補完済み）
        this.config = Object.assign(Object.assign({}, defaultTheme), merged);
        try {
            (0, atomicWrite_1.writeFileAtomicSync)(this.configPath, JSON.stringify(merged, null, 4), { encoding: 'utf-8' });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to save color config:', msg);
        }
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
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8');
                currentOnDisk = JSON.parse(data);
            }
            // 補完処理：デフォルト値をベースに、ディスクの内容を上書き（ディスク優先）
            const completed = Object.assign(Object.assign({}, defaultTheme), currentOnDisk);
            (0, atomicWrite_1.writeFileAtomicSync)(this.configPath, JSON.stringify(completed, null, 4), { encoding: 'utf-8' });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to persist color config on exit:', msg);
        }
    }
    getConfigPath() {
        this.ensureInitialized();
        return this.configPath;
    }
}
exports.ColorConfigService = ColorConfigService;
exports.colorConfigService = new ColorConfigService();
function registerColorHandlers() {
    electron_1.ipcMain.handle('get-color-config', () => {
        return exports.colorConfigService.getColorConfig();
    });
    electron_1.ipcMain.handle('save-color-config', (_, newConfig) => {
        exports.colorConfigService.saveColorConfig(newConfig);
        return true;
    });
    electron_1.ipcMain.handle('get-color-config-path', () => {
        return exports.colorConfigService.getConfigPath();
    });
}
