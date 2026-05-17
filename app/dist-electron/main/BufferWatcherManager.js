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
exports.bufferWatcherManager = exports.BufferWatcherManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pathKey_1 = require("./pathKey");
/**
 * BufferWatcherManager
 *
 * 開いているバッファに対応するファイルの外部変更を監視し、変更通知を
 * レンダラへ送る (auto-revert / 外部変更検知機能の main 側コア)。
 *
 * 設計上のポイント:
 *
 *   1. 監視は "ファイル単位" ではなく "そのファイルが含まれる親ディレクトリ単位"。
 *      atomic save (write-temp + rename) で原ファイルの inode が差し替わると、
 *      ファイル直接の fs.watch は OS によっては停止してしまうため。
 *      ディレクトリ watcher なら rename を捉えても watcher は生存し続ける。
 *
 *   2. 同一ディレクトリ内の複数バッファは 1 つの watcher を共有 (basename Set でフィルタ)。
 *      → N バッファ → ≤ N watchers にスケール、CPU/FD 消費を抑制。
 *
 *   3. 同一通知の連発は 500ms デバウンス (ビルドツールやフォーマッタの連続書き換え対策)。
 *      デバウンス対象キーは "dir + basename" 単位 (同 dir 内の別ファイルは独立)。
 *
 *   4. レンダラへ送る通知は filePath (Window/macOS は元の casing 保持) のみ。
 *      レンダラ側の pathsEqual で OS 慣習に従いマッチングする。
 *
 *   5. atomic save 由来の自分の rename は、レンダラ側で diskMtimeMs を保存時に更新済みのため、
 *      stat+mtime 比較段階でループバック判定されてフィルタされる (二重防御)。
 *
 * Linux 制約 (既存 watcher と同様):
 *   - Linux の fs.watch は recursive を非サポート。本実装はもともと "親ディレクトリ"
 *     非再帰なので影響なし (recursive: false)。
 */
const IS_LINUX = process.platform === 'linux';
class BufferWatcherManager {
    constructor() {
        this.dirs = new Map(); // dirKey → DirEntry
        this.mainWindow = null;
        /** debounce timer key: `${dirKey}::${basenameKey}` */
        this.debounceTimers = new Map();
    }
    setMainWindow(window) {
        this.mainWindow = window;
    }
    /**
     * 監視対象パス集合を最新化する (差分 reconcile)。
     * レンダラ側が現在開いている (検知対象の) バッファのファイルパス全集合を渡す前提。
     * - 既存に無いパス → そのファイルを管轄するディレクトリ watcher を確保 (なければ新規)
     * - 既存にあって新集合に無いパス → 当該ディレクトリの basename Set から外す。
     *   結果空になったディレクトリ watcher は close して dirs Map からも削除。
     */
    updateWatchPaths(filePaths) {
        // Build desired index: dirKey → Map<basenameKey, originalBasename>
        const desired = new Map();
        for (const fp of filePaths) {
            if (!fp)
                continue;
            // Windows パスでも path.dirname/basename は正しく動く (POSIX セパレータ混在も処理)。
            const dirPath = path.dirname(fp);
            const basename = path.basename(fp);
            if (!dirPath || !basename)
                continue;
            const dKey = (0, pathKey_1.pathKey)(dirPath);
            const bKey = (0, pathKey_1.pathKey)(basename);
            if (!desired.has(dKey))
                desired.set(dKey, new Map());
            desired.get(dKey).set(bKey, { dirPath, basename });
        }
        // Reconcile: remove dirs no longer needed.
        for (const [dKey, entry] of this.dirs.entries()) {
            if (!desired.has(dKey)) {
                this.closeDir(dKey, entry);
            }
        }
        // Reconcile: add / update dirs.
        for (const [dKey, basenameInfo] of desired.entries()) {
            const existing = this.dirs.get(dKey);
            const newBasenamesByKey = new Map();
            for (const [bKey, info] of basenameInfo) {
                newBasenamesByKey.set(bKey, info.basename);
            }
            if (!existing) {
                // 新規ディレクトリ。先頭の basename を持つ要素から dirPath を取得して watcher を立てる。
                const first = basenameInfo.values().next().value;
                if (!first)
                    continue;
                this.openDir(dKey, first.dirPath, newBasenamesByKey);
            }
            else {
                // 既存ディレクトリ。basename Set だけ更新 (watcher 維持)。
                existing.basenamesByKey = newBasenamesByKey;
            }
        }
    }
    openDir(dKey, dirPath, basenamesByKey) {
        try {
            // ディレクトリが存在しなければ watcher は張らない。バッファのファイルが
            // 一時的に "親ディレクトリも消失している" 状態 (例: USB 取り外し) では
            // 新たな変更を捕捉する手段がないので諦める。次に updateWatchPaths が呼ばれた
            // 際に再試行される (ディレクトリ復活時に拾える)。
            const stat = fs.statSync(dirPath, { throwIfNoEntry: false });
            if (!stat || !stat.isDirectory()) {
                // 後段の reconcile で外れるよう、空エントリだけ残しておく。
                this.dirs.set(dKey, { dirPath, basenamesByKey, watcher: null });
                return;
            }
            const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
                if (!filename)
                    return;
                // filename は string | Buffer。recursive=false なので相対パスではなく単なる basename を期待するが、
                // **Windows のドライブルート (例: 'D:\\') を watch している場合は、Windows / Node が先頭セパレータ
                // 付き ('\\test.md') で渡してくる**。ReadDirectoryChangesW が watch 対象に対する相対パスを返す仕様
                // で、watch dir 末尾の '\\' の影響でルート直下のファイルだけ先頭区切りが残るのが原因。
                // path.basename は冪等で、純 basename ('foo.txt') / 先頭区切り付き ('\\foo.txt' / '/foo.txt') /
                // サブパス ('sub/foo.txt') のどれを渡しても 'foo.txt' を返すので、ここで一律に通して
                // basenamesByKey の照合キーを一貫させる。
                const fnStr = typeof filename === 'string' ? filename : filename.toString();
                const cleanFilename = path.basename(fnStr);
                const bKey = (0, pathKey_1.pathKey)(cleanFilename);
                const entry = this.dirs.get(dKey);
                if (!entry)
                    return;
                const original = entry.basenamesByKey.get(bKey);
                if (!original)
                    return; // 監視対象外のファイル変更は無視
                this.scheduleNotify(dKey, bKey, entry.dirPath, original, eventType);
            });
            // Watcher エラー (ディレクトリ削除など) を握りつぶさない。
            // close を呼びエントリも消すことで、次の reconcile で再オープンできるようにする。
            watcher.on('error', (err) => {
                console.warn(`[BufferWatcher] error on ${dirPath}:`, err);
                const entry = this.dirs.get(dKey);
                if (entry && entry.watcher) {
                    try {
                        entry.watcher.close();
                    }
                    catch ( /* swallow */_a) { /* swallow */ }
                    entry.watcher = null;
                }
            });
            this.dirs.set(dKey, { dirPath, basenamesByKey, watcher });
        }
        catch (e) {
            // 権限がない / 削除済み / 一時的ロック中 など。沈黙して次回 reconcile に任せる。
            this.dirs.set(dKey, { dirPath, basenamesByKey, watcher: null });
        }
        // Linux で recursive 不可の警告は WorkspaceWatcherManager と重複するため出さない。
        void IS_LINUX;
    }
    closeDir(dKey, entry) {
        if (entry.watcher) {
            try {
                entry.watcher.close();
            }
            catch ( /* swallow */_a) { /* swallow */ }
        }
        // このディレクトリに紐づくデバウンスタイマーを掃除。
        for (const [tKey, timer] of this.debounceTimers.entries()) {
            if (tKey.startsWith(dKey + '::')) {
                clearTimeout(timer);
                this.debounceTimers.delete(tKey);
            }
        }
        this.dirs.delete(dKey);
    }
    scheduleNotify(dKey, bKey, dirPath, basename, eventType) {
        const tKey = `${dKey}::${bKey}`;
        const existing = this.debounceTimers.get(tKey);
        if (existing)
            clearTimeout(existing);
        const timer = setTimeout(() => {
            this.debounceTimers.delete(tKey);
            const entry = this.dirs.get(dKey);
            // デバウンス完了時にすでに監視対象から外れていれば送らない。
            if (!entry || !entry.basenamesByKey.has(bKey))
                return;
            this.notify(path.join(dirPath, basename), eventType);
        }, BufferWatcherManager.DEBOUNCE_MS);
        this.debounceTimers.set(tKey, timer);
    }
    notify(filePath, eventType) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('buffer-file-changed', {
                filePath,
                eventType, // 'rename' | 'change' (情報目的、レンダラ側は stat で再判定するので必須ではない)
            });
        }
    }
    dispose() {
        for (const [dKey, entry] of this.dirs.entries()) {
            this.closeDir(dKey, entry);
        }
        for (const t of this.debounceTimers.values())
            clearTimeout(t);
        this.debounceTimers.clear();
    }
}
exports.BufferWatcherManager = BufferWatcherManager;
BufferWatcherManager.DEBOUNCE_MS = 500;
exports.bufferWatcherManager = new BufferWatcherManager();
