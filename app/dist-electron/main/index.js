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
Object.defineProperty(exports, "__esModule", { value: true });
// 🚀 Check environment variable at the absolute earliest possible moment
// No other imports or logic should execute before this.
const isMcpRequested = process.env.ELECXZY_MCP_MODE === 'true';
if (isMcpRequested) {
    // 🌐 MCP Server Mode: Run directly in the main process
    try {
        const fs = require('fs');
        const path = require('path');
        // 🚀 Use absolute path to ensure the module is correctly resolved
        const mcpServerPath = path.join(__dirname, '../../dist-mcp/server.cjs');
        const { runMcpServer } = require(mcpServerPath);
        runMcpServer().catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('MCP Server Fatal Error:', msg);
            process.exit(1);
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Failed to load MCP server module:', msg);
        process.exit(1);
    }
}
else {
    // -----------------------------------------------------
    // 🖼️ GUI Mode: Electron context (deferred requires)
    // -----------------------------------------------------
    const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
    const path = require('path');
    const fs = require('fs');
    const iconv = require('iconv-lite');
    const jschardet = require('jschardet');
    const Encoding = require('encoding-japanese');
    // GUI-specific service imports (deferred to avoid loading Electron modules early)
    const { configService, registerConfigHandlers } = require('./ConfigService');
    const { registerKeybindsHandlers } = require('./KeybindsService');
    const { MenuBuilder } = require('./MenuBuilder');
    const { WindowStateManager } = require('./WindowState');
    const { toggleIme, setImeStatus, setupImeHook } = require('./WindowsIme');
    const { registerColorHandlers, colorConfigService } = require('./ColorConfigService');
    const { shellService } = require('./ShellService');
    const { grepService } = require('./GrepService');
    const { registerFileTreeHandler } = require('./fileTreeHandler');
    const { mcpGateway } = require('./McpGateway');
    const { ImporterRegistry } = require('./importer/ImporterRegistry');
    const { workspaceWatcherManager } = require('./WorkspaceWatcherManager');
    const { explorerWatcherManager } = require('./ExplorerWatcherManager');
    const { bufferWatcherManager } = require('./BufferWatcherManager');
    const { writeFileAtomic } = require('./atomicWrite');
    // Handle creating/removing shortcuts on Windows when installing/uninstalling.
    if (require('electron-squirrel-startup')) {
        app.quit();
    }
    // 🚀 Windows のタスクバーのピン留めや通知の識別子を固定。
    // これにより、再インストール時でも Windows が同じアプリとして認識しやすくなります。
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.elecxzy');
    }
    let mainWindow = null;
    // 🚀 保留中のファイルパス。レンダラが `renderer-ready` を通知するまでここにキュー。
    const pendingFilePaths = [];
    let isRendererReady = false;
    // Collect every file path passed in argv (skipping flags and non-files).
    // argv 内のすべての非フラグ引数を走査し、実在するファイルのみ resolve して返す。
    // 引数順を保つので、後段で順次オープンしたとき最後のファイルがアクティブになる。
    function getFilePathsFromArgv(argv) {
        const paths = [];
        for (let i = app.isPackaged ? 1 : 2; i < argv.length; i++) {
            const arg = argv[i];
            if (arg.startsWith('-'))
                continue;
            try {
                if (fs.existsSync(arg) && fs.statSync(arg).isFile()) {
                    paths.push(path.resolve(arg));
                }
            }
            catch (e) { }
        }
        return paths;
    }
    // レンダラ側に open-file を届ける共通経路。
    // レンダラのリスナ登録前に呼ばれた場合は pendingFilePaths に退避し、
    // `renderer-ready` 受信時にまとめて flush する。
    function deliverFilePath(filePath) {
        if (!filePath)
            return;
        if (isRendererReady && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('open-file', filePath);
        }
        else {
            pendingFilePaths.push(filePath);
        }
    }
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
    }
    else {
        app.on('second-instance', (event, commandLine) => {
            if (mainWindow) {
                if (mainWindow.isMinimized())
                    mainWindow.restore();
                mainWindow.focus();
            }
            // 🚀 mainWindow が未生成でも（第1起動完了前に第2起動が来た場合）パスを失わないよう、
            // ガード外で deliverFilePath に委ねる。
            for (const filePath of getFilePathsFromArgv(commandLine)) {
                deliverFilePath(filePath);
            }
        });
        pendingFilePaths.push(...getFilePathsFromArgv(process.argv));
    }
    if (!app.isPackaged) {
        const userDataPath = path.join(app.getPath('appData'), 'elecxzy-dev');
        app.setPath('userData', userDataPath);
    }
    // Fast path: Node's Buffer.toString uses V8's native (C++) string decoders for utf-8 and
    // utf-16le, several times faster than iconv-lite's JS path on large files. Returns null
    // for any encoding not natively supported (utf-16 without BOM, utf-16be, shift_jis, etc.),
    // letting the caller fall back to iconv. Mirrors iconv-lite's bomAware default by stripping
    // a leading U+FEFF so callers cannot tell the two paths apart.
    function tryNativeDecode(buffer, encoding) {
        const enc = encoding.toLowerCase();
        let str;
        if (enc === 'utf-8' || enc === 'utf8') {
            str = buffer.toString('utf-8');
        }
        else if (enc === 'utf-16le' || enc === 'utf16le' || enc === 'ucs-2' || enc === 'ucs2') {
            str = buffer.toString('utf16le');
        }
        else {
            return null;
        }
        return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
    }
    function decodeFile(buffer) {
        // Node Buffer is already a Uint8Array; encoding-japanese accepts TypedArray and only
        // reads via data[i] / data.length. Passing the buffer directly avoids a full copy
        // (ECMAScript's TypedArray-from-TypedArray constructor allocates and memcpys).
        const encodingJpResult = Encoding.detect(buffer);
        if (encodingJpResult && encodingJpResult !== 'ASCII') {
            const encodingMap = {
                'SJIS': 'Shift_JIS', 'EUCJP': 'EUC-JP', 'JIS': 'ISO-2022-JP',
                'UTF8': 'utf-8', 'UTF16': 'utf-16', 'UTF16BE': 'utf-16be',
                'UTF16LE': 'utf-16le', 'UTF32': 'utf-32', 'UNICODE': 'utf-16le',
            };
            const normalizedEncoding = encodingMap[encodingJpResult] || encodingJpResult.toLowerCase();
            if (iconv.encodingExists(normalizedEncoding)) {
                try {
                    const native = tryNativeDecode(buffer, normalizedEncoding);
                    return { content: native !== null && native !== void 0 ? native : iconv.decode(buffer, normalizedEncoding), encoding: normalizedEncoding };
                }
                catch (e) { }
            }
        }
        const detected = jschardet.detect(buffer);
        let encoding = detected.encoding || 'utf-8';
        if (!iconv.encodingExists(encoding))
            encoding = 'utf-8';
        try {
            const native = tryNativeDecode(buffer, encoding);
            return { content: native !== null && native !== void 0 ? native : iconv.decode(buffer, encoding), encoding };
        }
        catch (e) {
            return { content: buffer.toString('utf-8'), encoding: 'utf-8' };
        }
    }
    const getAppFilePath = (filename) => {
        if (app.isPackaged) {
            const externalPath = path.join(path.dirname(process.execPath), filename);
            if (fs.existsSync(externalPath))
                return externalPath;
            const resourcesPath = path.join(process.resourcesPath, filename);
            if (fs.existsSync(resourcesPath))
                return resourcesPath;
        }
        return path.join(app.getAppPath(), filename);
    };
    const registerIpcHandlers = () => {
        ipcMain.handle('dialog:openFile', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const { canceled, filePaths } = yield dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
            if (canceled)
                return { canceled: true };
            const filePath = filePaths[0];
            // Check if automatic import is needed
            if (ImporterRegistry.isSupported(filePath)) {
                try {
                    const content = yield ImporterRegistry.extractTextFromFile(filePath);
                    return { canceled: false, filePath, content, encoding: 'UTF-8 (Imported)', readOnly: true };
                }
                catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error(`[Main] Importer failed for ${filePath}:`, msg);
                    const errorMsg = `[Import Error] Failed to extract text from this document.\nReason: ${msg}\n\nThis file is protected from overwriting to prevent data loss.`;
                    return { canceled: false, filePath, content: errorMsg, encoding: 'UTF-8 (Error)', readOnly: true };
                }
            }
            // 外部変更検知 (auto-revert) のため mtime を併せて返す。
            // dialog:openFile は明示的な open 経路で readOnly = false 確定なので mtime は必須。
            const stat = yield fs.promises.stat(filePath).catch(() => null);
            const { content, encoding } = decodeFile(yield fs.promises.readFile(filePath));
            return { canceled: false, filePath, content, encoding, mtimeMs: (_a = stat === null || stat === void 0 ? void 0 : stat.mtimeMs) !== null && _a !== void 0 ? _a : null };
        }));
        ipcMain.handle('show-open-dialog', (event, options) => __awaiter(void 0, void 0, void 0, function* () {
            const { canceled, filePaths } = yield dialog.showOpenDialog(mainWindow, Object.assign(Object.assign({}, options), { properties: ['openFile'] }));
            return canceled ? null : filePaths[0];
        }));
        ipcMain.handle('show-open-directory-dialog', (event, options) => __awaiter(void 0, void 0, void 0, function* () {
            const { canceled, filePaths } = yield dialog.showOpenDialog(mainWindow, Object.assign(Object.assign({}, options), { properties: ['openDirectory', 'createDirectory'] }));
            return canceled ? null : filePaths[0];
        }));
        ipcMain.handle('show-save-dialog', (event, options) => __awaiter(void 0, void 0, void 0, function* () {
            const { canceled, filePath } = yield dialog.showSaveDialog(mainWindow, Object.assign({}, options));
            return canceled ? null : filePath;
        }));
        ipcMain.handle('read-file', (event, filePath) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                // Async stat: rejects on missing/inaccessible files; treat as null (same as the
                // original existsSync-false branch). One syscall instead of existsSync + statSync.
                const stat = yield fs.promises.stat(filePath).catch(() => null);
                if (!stat || !stat.isFile())
                    return null;
                // Check if automatic import is needed
                if (ImporterRegistry.isSupported(filePath)) {
                    try {
                        const content = yield ImporterRegistry.extractTextFromFile(filePath);
                        return { content, encoding: 'UTF-8 (Imported)', readOnly: true };
                    }
                    catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        console.error(`[Main] Importer failed for ${filePath}:`, msg);
                        const errorMsg = `[Import Error] Failed to extract text from this document.\nReason: ${msg}\n\nThis file is protected from overwriting to prevent data loss.`;
                        return { canceled: false, filePath, content: errorMsg, encoding: 'UTF-8 (Error)', readOnly: true };
                    }
                }
                // Async read so the main process event loop (and the UI) keeps running while
                // large files are streamed off disk.
                // 外部変更検知 (auto-revert) のため mtimeMs を併せて返す。
                const decoded = decodeFile(yield fs.promises.readFile(filePath));
                return Object.assign(Object.assign({}, decoded), { mtimeMs: stat.mtimeMs });
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[Main] Read file error for ${filePath}:`, msg);
                return null;
            }
        }));
        ipcMain.handle('read-directory', (event, dirPath) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                // 非同期 stat: ENOENT などは null として吸収（旧 existsSync==false 経路と同じ扱い）。
                // existsSync + statSync の 2 syscall を 1 syscall に圧縮。
                const dirStat = yield fs.promises.stat(dirPath).catch(() => null);
                if (!dirStat || !dirStat.isDirectory())
                    return [];
                const dirents = yield fs.promises.readdir(dirPath, { withFileTypes: true });
                // シンボリックリンクの解決を Promise.all で並列化。リンクでないエントリは即時値を返す
                // ので await のオーバーヘッドのみで実体 stat は走らない。失敗 (dangling link 等) は
                // isDirectory=false にフォールバック (旧 try/catch と同じ挙動)。
                return yield Promise.all(dirents.map((dirent) => __awaiter(void 0, void 0, void 0, function* () {
                    const fullPath = path.join(dirPath, dirent.name);
                    let isDirectory = dirent.isDirectory();
                    if (!isDirectory && dirent.isSymbolicLink()) {
                        const linkStat = yield fs.promises.stat(fullPath).catch(() => null);
                        if (linkStat)
                            isDirectory = linkStat.isDirectory();
                    }
                    return { name: dirent.name, isDirectory, path: fullPath };
                })));
            }
            catch (e) {
                return [];
            }
        }));
        ipcMain.handle('get-file-stat', (event, filePath) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                // パス補完などで頻繁に呼ばれる経路。低速ディスクやネットワーク共有でも
                // メインプロセスのイベントループを塞がないよう、stat / access を非同期にする。
                const stat = yield fs.promises.stat(filePath);
                let isWritable = false;
                // 💡 Prevent overwriting binary files with extracted text
                if (ImporterRegistry.isSupported(filePath)) {
                    isWritable = false;
                }
                else {
                    try {
                        yield fs.promises.access(filePath, fs.constants.W_OK);
                        isWritable = true;
                    }
                    catch (e) { }
                }
                return { isDirectory: stat.isDirectory(), isFile: stat.isFile(), size: stat.size, mtime: stat.mtime, mtimeMs: stat.mtimeMs, isWritable };
            }
            catch (e) {
                return null;
            }
        }));
        // 🚀 TOCTOU-safe な「ファイル占有」用 IPC。
        // open(path, 'wx') は POSIX/Win32 ともに「存在しなければ作る、存在すれば失敗」を
        // 1 つの syscall でアトミックに行う (POSIX: O_CREAT|O_EXCL / Win32: CREATE_NEW)。
        // MCP の save_file 側で「存在しない確認」と「書き込み」の間の race を塞ぐため、
        // この IPC で空ファイルとしてパスを占有してから本書き込みに進む。
        ipcMain.handle('claim-file-exclusive', (_event, filePath) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                // 親ディレクトリを先に作っておく (save-file IPC と同じ挙動)。
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    yield fs.promises.mkdir(dir, { recursive: true });
                }
                const fd = yield fs.promises.open(filePath, 'wx', 0o666);
                yield fd.close();
                return { ok: true };
            }
            catch (err) {
                if (err && err.code === 'EEXIST')
                    return { ok: false, reason: 'exists' };
                const msg = err instanceof Error ? err.message : String(err);
                return { ok: false, reason: 'error', message: msg };
            }
        }));
        // claim-file-exclusive で作った空のプレースホルダを開放する。安全装置として
        // 「ファイルが存在し、かつ size が 0」の場合のみ削除する: 万一書き込み済みの
        // ファイルだったら触らずに { ok: false, reason: 'not-empty' } を返す。
        ipcMain.handle('release-empty-file', (_event, filePath) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const stat = yield fs.promises.stat(filePath);
                if (stat.isFile() && stat.size === 0) {
                    yield fs.promises.unlink(filePath);
                    return { ok: true };
                }
                return { ok: false, reason: 'not-empty' };
            }
            catch (err) {
                if (err && err.code === 'ENOENT')
                    return { ok: true }; // 既に消えている = 目的達成
                const msg = err instanceof Error ? err.message : String(err);
                return { ok: false, reason: 'error', message: msg };
            }
        }));
        ipcMain.handle('get-user-home', () => app.getPath('home'));
        ipcMain.handle('save-file', (event, content, filePath, encoding) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            try {
                // 💡 CRITICAL SAFETY GUARD: Prevent overwriting original binary files (PDF, Word, Excel) with plain text.
                // This is the final authority to prevent data loss.
                if (ImporterRegistry.isSupported(filePath)) {
                    return {
                        success: false,
                        error: 'Cannot overwrite original binary documents. Please use "Save As" (C-x C-w / C-x M-w) to save the extracted text to a new file.'
                    };
                }
                if (!encoding || !iconv.encodingExists(encoding))
                    encoding = 'utf-8';
                // Ensure directory exists
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                // Atomic write: write temp + fsync + rename. Prevents truncation of the
                // existing file if the editor / OS dies mid-write.
                yield writeFileAtomic(filePath, iconv.encode(content, encoding));
                // 外部変更検知 (auto-revert) のため、保存直後の mtimeMs を返す。
                // この値をバッファに記録しておくことで、自分自身の保存に伴う rename イベントで watcher が
                // 発火しても、mtime 一致でループバック扱いとなり誤った再 revert を防げる。
                // stat 失敗 (極めて稀) は null を返し、呼び出し側はその場合の検知を一時的に無効化する
                // (= 次の保存・open まで disk 同期点なし) ことで安全側に倒す。
                const newStat = yield fs.promises.stat(filePath).catch(() => null);
                return { success: true, mtimeMs: (_a = newStat === null || newStat === void 0 ? void 0 : newStat.mtimeMs) !== null && _a !== void 0 ? _a : null };
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[Main] save-file error for ${filePath}:`, msg);
                return { success: false, error: msg };
            }
        }));
        ipcMain.handle('get-system-fonts', () => __awaiter(void 0, void 0, void 0, function* () {
            if (process.platform === 'win32') {
                const { exec } = require('child_process');
                return new Promise((resolve) => {
                    const psCommand = `$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name`;
                    exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`, { encoding: 'utf8' }, (error, stdout) => {
                        if (error) {
                            resolve([]);
                            return;
                        }
                        resolve(stdout.split(/\r?\n/).map(s => s.trim()).filter(s => s));
                    });
                });
            }
            return [];
        }));
        ipcMain.handle('get-working-directory', () => __awaiter(void 0, void 0, void 0, function* () { return process.cwd(); }));
        ipcMain.handle('get-app-info', () => ({ name: app.getName(), version: app.getVersion(), versions: process.versions, platform: process.platform }));
        ipcMain.handle('get-license-content', () => __awaiter(void 0, void 0, void 0, function* () {
            try {
                return fs.readFileSync(getAppFilePath('LICENSE')).toString('utf-8');
            }
            catch (e) {
                return 'LICENSE file not found.';
            }
        }));
        ipcMain.handle('get-command-list-content', () => __awaiter(void 0, void 0, void 0, function* () {
            try {
                return fs.readFileSync(getAppFilePath('COMMANDLIST.md')).toString('utf-8');
            }
            catch (e) {
                return 'COMMANDLIST.md file not found.';
            }
        }));
        ipcMain.handle('read-workspace-file', (event, filePath) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const config = JSON.parse(content);
                if (!config.folders || !Array.isArray(config.folders)) {
                    throw new Error('Invalid workspace file: "folders" array is missing.');
                }
                const workspaceDir = path.dirname(filePath);
                const resolvedFolders = config.folders.map((f) => {
                    let resolvedPath = f.path;
                    if (!path.isAbsolute(resolvedPath)) {
                        resolvedPath = path.resolve(workspaceDir, resolvedPath);
                    }
                    return {
                        path: resolvedPath,
                        name: f.name || path.basename(resolvedPath)
                    };
                });
                return {
                    folders: resolvedFolders,
                    filePath: filePath
                };
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[Main] Failed to read workspace file: ${filePath}`, msg);
                throw e;
            }
        }));
        ipcMain.handle('save-workspace-file', (event, filePath, folders) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const workspaceDir = path.dirname(filePath);
                const foldersToSave = folders.map(f => {
                    let finalPath = f.path;
                    if (path.isAbsolute(f.path)) {
                        const relativePart = path.relative(workspaceDir, f.path);
                        if (path.isAbsolute(relativePart)) {
                            // Different drives on Windows - keep as absolute path
                            finalPath = relativePart.split(path.sep).join('/');
                        }
                        else {
                            // Same drive - use relative path
                            let posixRelative = relativePart.split(path.sep).join('/');
                            if (!posixRelative.startsWith('.') && !posixRelative.startsWith('/')) {
                                posixRelative = './' + posixRelative;
                            }
                            finalPath = posixRelative;
                        }
                    }
                    return Object.assign(Object.assign({}, f), { path: finalPath });
                });
                let config = { folders: foldersToSave };
                if (fs.existsSync(filePath)) {
                    try {
                        const existingContent = fs.readFileSync(filePath, 'utf-8');
                        config = JSON.parse(existingContent);
                        config.folders = foldersToSave;
                    }
                    catch (e) {
                        // If failed to parse, we'll just overwrite with the new folders
                        config = { folders: foldersToSave };
                    }
                }
                // Ensure directory exists
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                yield writeFileAtomic(filePath, JSON.stringify(config, null, 2));
                return { success: true };
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[Main] Failed to save workspace file: ${filePath}`, msg);
                return { success: false, error: msg };
            }
        }));
        ipcMain.handle('resolve-path', (event, filePath) => path.resolve(filePath));
        ipcMain.handle('toggle-ime', () => __awaiter(void 0, void 0, void 0, function* () { return yield toggleIme(); }));
        ipcMain.handle('set-ime-status', (event, open) => __awaiter(void 0, void 0, void 0, function* () { return yield setImeStatus(open); }));
        ipcMain.handle('mcp:start', () => __awaiter(void 0, void 0, void 0, function* () {
            try {
                // 🚀 起動前ガード: config.json の mcpAllowedDirectories を検証する。
                // 1) 1 件以上の有効なエントリが必要 (空文字や undefined は無効)
                // 2) 全エントリが実在するディレクトリでなければならない
                // どちらかを満たさない場合は MCP サーバを起動せず、ユーザに設定を促すメッセージを返す。
                const cfg = configService.get();
                const rawList = Array.isArray(cfg.mcpAllowedDirectories) ? cfg.mcpAllowedDirectories : [];
                const cleaned = rawList.map(p => (typeof p === 'string' ? p.trim() : '')).filter(p => p.length > 0);
                if (cleaned.length === 0) {
                    return {
                        ok: false,
                        error: 'mcp-start aborted: No allowed directories configured. Set "mcpAllowedDirectories" in config.json or via Settings (M-x open-config).'
                    };
                }
                const missing = [];
                for (const dir of cleaned) {
                    try {
                        const resolved = path.resolve(dir);
                        const stat = fs.statSync(resolved);
                        if (!stat.isDirectory())
                            missing.push(dir);
                    }
                    catch (e) {
                        missing.push(dir);
                    }
                }
                if (missing.length > 0) {
                    return {
                        ok: false,
                        error: `mcp-start aborted: Allowed directory not found: ${missing.join(', ')}. Update "mcpAllowedDirectories" in config.json or via Settings.`
                    };
                }
                yield mcpGateway.startMcpProcess();
                return { ok: true };
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[Main] Failed to handle mcp:start', msg);
                return { ok: false, error: `mcp-start failed: ${msg}` };
            }
        }));
        ipcMain.handle('mcp:stop', () => {
            try {
                mcpGateway.stopMcpProcess();
                return true;
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[Main] Failed to handle mcp:stop', msg);
                return false;
            }
        });
        ipcMain.handle('mcp:status', () => {
            try {
                return mcpGateway.getStatus();
            }
            catch (e) {
                return false;
            }
        });
        // 🚀 レンダラが onOpenFile リスナを登録し終えた合図。
        // 保留中のファイルパスを一括で送出する。
        ipcMain.on('renderer-ready', (event) => {
            // 現行の mainWindow 以外からの通知は無視（ウィンドウ差し替え時の保険）
            if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents)
                return;
            isRendererReady = true;
            if (pendingFilePaths.length === 0)
                return;
            const toFlush = pendingFilePaths.splice(0, pendingFilePaths.length);
            for (const p of toFlush) {
                mainWindow.webContents.send('open-file', p);
            }
        });
        // Fire-and-forget: the renderer doesn't await the result, so use send/on to avoid
        // allocating a Promise per workspace mutation.
        ipcMain.on('update-workspace-watchers', (event, folders) => {
            workspaceWatcherManager.updateWatchers(folders);
        });
        ipcMain.on('update-explorer-watcher', (event, path) => {
            explorerWatcherManager.setWatchPath(path);
        });
        // 外部変更検知 (auto-revert) 用 — 開いているバッファのファイルパス全集合を受け取り、
        // BufferWatcherManager 側で差分 reconcile してディレクトリ単位 watcher を確保する。
        // fire-and-forget (workspace-watchers と同パターン)。
        ipcMain.on('update-buffer-watchers', (_event, filePaths) => {
            bufferWatcherManager.updateWatchPaths(Array.isArray(filePaths) ? filePaths : []);
        });
    };
    const createWindow = () => {
        // 🚀 新しいウィンドウでは renderer-ready を改めて待つ。
        // 既存の pendingFilePaths は破棄せず、次の renderer-ready で flush する。
        isRendererReady = false;
        registerColorHandlers();
        const colors = colorConfigService.getColorConfig();
        const windowState = new WindowStateManager();
        const state = windowState.load();
        const iconExt = process.platform === 'win32' ? 'ico' : 'png';
        const iconPath = path.join(__dirname, app.isPackaged
            ? `../../dist/icon.${iconExt}`
            : `../../public/icon.${iconExt}`);
        mainWindow = new BrowserWindow(Object.assign(Object.assign({ icon: iconPath, width: state.width, height: state.height, x: state.x, y: state.y, show: false, webPreferences: {
                preload: path.join(__dirname, '../preload/index.js'),
                nodeIntegration: false,
                contextIsolation: true,
                webviewTag: true
            }, titleBarStyle: process.platform === 'win32' || process.platform === 'darwin' ? 'hidden' : 'default' }, (process.platform === 'win32' ? {
            titleBarOverlay: {
                color: colors.titleBarBackground,
                symbolColor: colors.titleBarForeground
            }
        } : {})), { backgroundColor: colors.editorBackground }));
        if (state.isMaximized)
            mainWindow.maximize();
        mainWindow.once('ready-to-show', () => {
            mainWindow.show();
            // 🚀 保留中ファイルの flush はレンダラの `renderer-ready` 受信後に行う。
            // ここで送ってしまうとレンダラ側の listener 登録前になり欠落する可能性があるため。
        });
        // 🚀 ページリロード（F5 / 開発時の再読み込み）時に ready フラグをリセット。
        // これにより、リロード中に second-instance が飛んで来ても pending に退避できる。
        mainWindow.webContents.on('did-start-loading', () => {
            isRendererReady = false;
        });
        const saveState = () => { if (mainWindow)
            windowState.save(mainWindow); };
        mainWindow.on('resize', saveState);
        mainWindow.on('move', saveState);
        mainWindow.on('maximize', saveState);
        mainWindow.on('unmaximize', saveState);
        mainWindow.on('close', (e) => {
            if (!isReadyToQuit) {
                e.preventDefault();
                mainWindow.webContents.send('app-close-request');
                return;
            }
            windowState.save(mainWindow, true);
        });
        const menuBuilder = new MenuBuilder(mainWindow);
        menuBuilder.buildMenu();
        mcpGateway.init(mainWindow);
        workspaceWatcherManager.setMainWindow(mainWindow);
        explorerWatcherManager.setMainWindow(mainWindow);
        bufferWatcherManager.setMainWindow(mainWindow);
        setupImeHook(mainWindow);
        const distPath = path.resolve(__dirname, '../../dist/index.html');
        if (!app.isPackaged && !fs.existsSync(distPath)) {
            mainWindow.loadURL('http://localhost:5173');
        }
        else if (fs.existsSync(distPath)) {
            mainWindow.loadFile(distPath);
        }
        mainWindow.webContents.on('will-attach-webview', (event, webPreferences) => {
            webPreferences.nodeIntegration = false;
            webPreferences.contextIsolation = true;
        });
        // 🚀 外部リンクは OS 既定ブラウザで開き、エディタウィンドウ自体は遷移させない。
        // プレビュー (HtmlPreview / MarkdownPreview) 内の <a href="https://..."> をクリック
        // した際に、メインウィンドウが外部 URL に navigate して操作不能になるのを防ぐ。
        const isInternalNavigation = (url) => {
            // file:// (パッケージ済みの dist/index.html) と localhost:5173 (dev mode) は許可。
            // about:blank も Electron の内部遷移で発火することがあるため許可。
            return url.startsWith('file://')
                || url.startsWith('http://localhost:5173')
                || url === 'about:blank';
        };
        const isSafeExternal = (url) => {
            // OS 既定ブラウザに渡してよいスキームのみ。javascript: / file: などは渡さない。
            return /^(?:https?|mailto):/i.test(url);
        };
        mainWindow.webContents.on('will-navigate', (event, url) => {
            if (isInternalNavigation(url))
                return;
            event.preventDefault();
            if (isSafeExternal(url))
                shell.openExternal(url);
        });
        mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (isSafeExternal(url))
                shell.openExternal(url);
            return { action: 'deny' };
        });
        mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
            if (details.webContentsId === (mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.webContents.id))
                return callback({ cancel: false });
            if (!details.responseHeaders)
                return callback({ cancel: false });
            const headers = Object.assign({}, details.responseHeaders);
            delete headers['x-frame-options'];
            delete headers['X-Frame-Options'];
            delete headers['content-security-policy'];
            delete headers['Content-Security-Policy'];
            callback({ cancel: false, responseHeaders: headers });
        });
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (mainWindow && input.type === 'keyDown') {
                const isShortcut = input.control || input.alt || (input.meta && process.platform === 'darwin');
                if (isShortcut || isInPrefixState) {
                    mainWindow.webContents.send('global-keydown', { key: input.key, code: input.code, ctrlKey: input.control, altKey: input.alt, shiftKey: input.shift, metaKey: input.meta });
                    event.preventDefault();
                }
            }
        });
    };
    let isReadyToQuit = false;
    ipcMain.on('confirm-quit', () => { isReadyToQuit = true; if (mainWindow)
        mainWindow.close(); });
    let isInPrefixState = false;
    ipcMain.on('set-prefix-state', (event, state) => { isInPrefixState = state; });
    app.on('ready', () => __awaiter(void 0, void 0, void 0, function* () {
        if (gotTheLock) {
            yield configService.init();
            shellService.init();
            grepService.init();
            registerFileTreeHandler();
            registerConfigHandlers();
            registerKeybindsHandlers();
            registerIpcHandlers();
            createWindow();
        }
    }));
    app.on('before-quit', () => {
        shellService.killAll();
        grepService.killAll();
        configService.persist();
        colorConfigService.persist();
        mcpGateway.dispose();
        workspaceWatcherManager.dispose();
        explorerWatcherManager.dispose();
        bufferWatcherManager.dispose();
    });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin')
        app.quit(); });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0)
        createWindow(); });
}
