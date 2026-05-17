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
exports.explorerWatcherManager = exports.ExplorerWatcherManager = void 0;
const fs = __importStar(require("fs"));
const pathKey_1 = require("./pathKey");
// Node の fs.watch は Linux で recursive: true をサポートしておらず、Node 20+ では
// ERR_FEATURE_UNAVAILABLE_ON_PLATFORM を throw する。Linux では root のみ非再帰で watch し、
// サブディレクトリの変更は通知できない旨をセッション中 1 回だけ警告する。
const IS_LINUX = process.platform === 'linux';
/**
 * ExplorerWatcherManager
 *
 * ファイラサイドバー (SidebarTree) の現在 root を 1 つだけ監視し、
 * 変更があった場合にレンダラープロセスへ通知します。
 */
class ExplorerWatcherManager {
    constructor() {
        this.watcher = null;
        this.watchedPath = null;
        this.mainWindow = null;
        this.linuxWarningShown = false;
    }
    setMainWindow(window) {
        this.mainWindow = window;
    }
    /**
     * 監視対象を更新します。'::DRIVES::' (仮想 root) や null/空文字列を渡すと監視を停止します。
     */
    setWatchPath(path) {
        const targetPath = (!path || path === '::DRIVES::') ? null : path;
        // 🚀 OS の慣習で同一視 (Windows/macOS: case-insensitive、Linux: case-sensitive)。
        //    casing 違いだけで watcher を close → reopen する無駄なチャーンを防ぐ。
        //    両方が null の場合は pathsEqual が false を返すため、ヌルチェックを併用する。
        if (targetPath === this.watchedPath || (targetPath && this.watchedPath && (0, pathKey_1.pathsEqual)(targetPath, this.watchedPath)))
            return;
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.watchedPath = targetPath;
        if (!targetPath)
            return;
        if (IS_LINUX && !this.linuxWarningShown) {
            console.warn('[ExplorerWatcher] fs.watch recursive mode is not supported on Linux. ' +
                'Only the root of the explorer sidebar will be monitored — ' +
                'changes in subdirectories will not refresh the tree. ' +
                'See https://nodejs.org/api/fs.html#caveats');
            this.linuxWarningShown = true;
        }
        try {
            this.watcher = fs.watch(targetPath, { recursive: !IS_LINUX }, (_eventType, filename) => {
                this.notifyChange(filename);
            });
        }
        catch (e) {
            console.error(`[ExplorerWatcher] Failed to watch ${targetPath}:`, e);
            this.watchedPath = null;
        }
    }
    notifyChange(filename) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('explorer-file-changed', { filename });
        }
    }
    dispose() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.watchedPath = null;
    }
}
exports.ExplorerWatcherManager = ExplorerWatcherManager;
exports.explorerWatcherManager = new ExplorerWatcherManager();
