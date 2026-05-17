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
exports.workspaceWatcherManager = exports.WorkspaceWatcherManager = void 0;
const fs = __importStar(require("fs"));
const pathKey_1 = require("./pathKey");
/**
 * WorkspaceWatcherManager
 *
 * マルチ・ルート・ワークスペースの各フォルダを監視し、
 * 変更があった場合にレンダラープロセスへ通知します。
 */
// Node の fs.watch は Linux で recursive: true をサポートしておらず、Node 20+ では
// ERR_FEATURE_UNAVAILABLE_ON_PLATFORM を throw する。Linux では root のみ非再帰で watch し、
// サブディレクトリの変更は通知できない旨をセッション中 1 回だけ警告する。
const IS_LINUX = process.platform === 'linux';
class WorkspaceWatcherManager {
    constructor() {
        this.watchers = new Map();
        this.mainWindow = null;
        this.linuxWarningShown = false;
    }
    setMainWindow(window) {
        this.mainWindow = window;
    }
    /**
     * ワークスペースのフォルダ一覧に基づいて監視対象を更新します。
     * 差分を計算して、新しいフォルダのみ監視を開始し、不要になった監視を停止します。
     *
     * 🚀 Map のキーは `pathKey()` で OS の慣習に従い正規化（Windows/macOS: case-insensitive、
     *    Linux: case-sensitive）。これにより同じフォルダを違う casing で受け取っても、
     *    監視のチャーン（close → 直後に同じ実フォルダを reopen）が起きない。
     *    実際の fs.watch とレンダラー通知には原文の path をそのまま渡す。
     */
    updateWatchers(folders) {
        const newKeys = new Set(folders.map(f => (0, pathKey_1.pathKey)(f.path)));
        // 削除されたフォルダの監視を停止
        for (const [key, watcher] of this.watchers.entries()) {
            if (!newKeys.has(key)) {
                watcher.close();
                this.watchers.delete(key);
            }
        }
        if (IS_LINUX && folders.length > 0 && !this.linuxWarningShown) {
            console.warn('[Watcher] fs.watch recursive mode is not supported on Linux. ' +
                'Only the root of each workspace folder will be monitored — ' +
                'changes in subdirectories will not refresh the workspace tree. ' +
                'See https://nodejs.org/api/fs.html#caveats');
            this.linuxWarningShown = true;
        }
        // 新しいフォルダの監視を開始
        for (const folder of folders) {
            const key = (0, pathKey_1.pathKey)(folder.path);
            if (!this.watchers.has(key)) {
                try {
                    // フォルダが存在する場合のみ監視を開始
                    if (fs.existsSync(folder.path)) {
                        const watcher = fs.watch(folder.path, { recursive: !IS_LINUX }, (eventType, filename) => {
                            this.notifyChange(folder.path, filename);
                        });
                        this.watchers.set(key, watcher);
                    }
                }
                catch (e) {
                    // 存在しない場合やアクセス権限がない場合は静かに無視する
                }
            }
        }
    }
    notifyChange(rootPath, filename) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('workspace-file-changed', {
                rootPath,
                filename
            });
        }
    }
    dispose() {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
    }
}
exports.WorkspaceWatcherManager = WorkspaceWatcherManager;
exports.workspaceWatcherManager = new WorkspaceWatcherManager();
