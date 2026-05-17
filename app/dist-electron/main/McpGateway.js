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
exports.mcpGateway = exports.McpGateway = void 0;
const electron_1 = require("electron");
const net_1 = __importDefault(require("net"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
/**
 * McpGateway
 * 外部の MCP Server (Node.js/TypeScript) と Renderer プロセス（React）の橋渡しを行う。
 * Named Pipe (Win) / Unix Domain Socket (Unix) を介して MCP Server と通信し、
 * 内容を Electron の IPC 経由で Renderer プロセスへ転送する。
 *
 * セッショントークンによる認証 (Layer B):
 * - mcp-start のたびに crypto.randomBytes(32) で新規トークンを生成し、
 *   `<userData>/.mcp-token` に mode 0o600 で書き出す。
 * - 名前付きパイプ／Unix ソケットに接続したクライアントは、最初のメッセージで
 *   { id, auth: <token> } を送る必要がある。一致しない、もしくは 5 秒以内に
 *   送信しなかったソケットは destroy する。
 * - mcp-stop でトークンファイルを削除し、メモリ上のトークンも破棄するので、
 *   旧セッションのリプレイは成立しない。
 */
const TOKEN_FILENAME = '.mcp-token';
const AUTH_TIMEOUT_MS = 5000;
class McpGateway {
    constructor() {
        this.server = null;
        this.mainWindow = null;
        this.pendingRequests = new Map();
        this.activeSockets = new Set(); // 🚀 接続中ソケットの管理リスト
        this.authenticatedSockets = new WeakSet();
        this.mcpEnabled = false;
        this.mcpResponseHandler = null;
        this.startingPromise = null;
        this.currentToken = null;
        this.pipePath = process.platform === 'win32'
            ? '\\\\.\\pipe\\elecxzy-mcp'
            : path_1.default.join(process.env.TMPDIR || '/tmp', 'elecxzy-mcp.sock');
    }
    getTokenPath() {
        return path_1.default.join(electron_1.app.getPath('userData'), TOKEN_FILENAME);
    }
    /**
     * 新規トークンを生成してファイルに書き出す。
     * 既存のトークンファイルは上書きする。
     */
    generateAndWriteToken() {
        const token = crypto_1.default.randomBytes(32).toString('hex');
        const tokenPath = this.getTokenPath();
        const tmpPath = `${tokenPath}.tmp-${process.pid}-${crypto_1.default.randomBytes(4).toString('hex')}`;
        let fd = null;
        try {
            // 'wx' + 0o600 で「他者から読まれない」状態でファイル作成。
            fd = fs_1.default.openSync(tmpPath, 'wx', 0o600);
            fs_1.default.writeFileSync(fd, token, 'utf-8');
            fs_1.default.fsyncSync(fd);
            fs_1.default.closeSync(fd);
            fd = null;
            // 既存ファイルを atomic に置換 (POSIX rename / Windows MoveFileEx)
            fs_1.default.renameSync(tmpPath, tokenPath);
            // POSIX 上で rename が mode を維持するが、念のため再適用 (umask の影響回避)
            try {
                fs_1.default.chmodSync(tokenPath, 0o600);
            }
            catch ( /* Windows では no-op */_a) { /* Windows では no-op */ }
        }
        catch (err) {
            if (fd !== null) {
                try {
                    fs_1.default.closeSync(fd);
                }
                catch ( /* ignore */_b) { /* ignore */ }
            }
            try {
                fs_1.default.unlinkSync(tmpPath);
            }
            catch ( /* ignore */_c) { /* ignore */ }
            throw err;
        }
        return token;
    }
    deleteTokenFile() {
        try {
            fs_1.default.unlinkSync(this.getTokenPath());
        }
        catch ( /* 既に消えていれば無視 */_a) { /* 既に消えていれば無視 */ }
    }
    /**
     * timing-safe にトークンを比較する。長さが違う場合は false を返す
     * (timingSafeEqual は同じ長さの Buffer を要求するので、その前段で長さ比較)。
     */
    isAuthValid(provided) {
        if (typeof provided !== 'string' || !this.currentToken)
            return false;
        const expected = Buffer.from(this.currentToken, 'utf-8');
        const got = Buffer.from(provided, 'utf-8');
        if (got.length !== expected.length)
            return false;
        return crypto_1.default.timingSafeEqual(got, expected);
    }
    init(mainWindow) {
        this.mainWindow = mainWindow;
        this.registerIpcHandlers();
    }
    /**
     * MCP サーバー（外部プロセス）からの接続を待ち受ける IPC サーバーを開始する。
     * M-x mcp-start で呼ばれる。
     */
    startServer() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.server)
                return;
            if (this.startingPromise)
                return this.startingPromise;
            // listen 開始前にトークンを生成しておく。失敗したら listen も諦める
            // (トークンが書けないと正規クライアントが接続できないため)。
            try {
                this.currentToken = this.generateAndWriteToken();
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error('[McpGateway] Failed to generate auth token:', msg);
                throw err;
            }
            const performStart = () => __awaiter(this, void 0, void 0, function* () {
                // 最大 15 回のリトライを試みる（指数バックオフ）
                let delay = 200;
                for (let i = 0; i < 15; i++) {
                    try {
                        yield new Promise((resolve, reject) => {
                            const server = net_1.default.createServer((socket) => {
                                console.log('[McpGateway] MCP Server connected to pipe');
                                this.activeSockets.add(socket); // 🚀 ソケットを管理リストに追加
                                // 認証タイムアウト: AUTH_TIMEOUT_MS 以内に有効な auth が来なければ切断。
                                // close ハンドラ内でも確実にクリアする。
                                const authTimer = setTimeout(() => {
                                    if (!this.authenticatedSockets.has(socket) && !socket.destroyed) {
                                        console.warn('[McpGateway] Auth timeout, destroying socket');
                                        socket.destroy();
                                    }
                                }, AUTH_TIMEOUT_MS);
                                let buffer = '';
                                socket.on('data', (data) => {
                                    buffer += data.toString();
                                    const parts = buffer.split('\n');
                                    buffer = parts.pop() || '';
                                    for (const part of parts) {
                                        if (!part.trim())
                                            continue;
                                        try {
                                            const request = JSON.parse(part);
                                            this.handleMcpRequest(request, socket, authTimer);
                                        }
                                        catch (e) {
                                            const msg = e instanceof Error ? e.message : String(e);
                                            console.error('[McpGateway] Failed to parse MCP request:', msg);
                                        }
                                    }
                                });
                                socket.on('error', (err) => {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    console.error('[McpGateway] Pipe Socket error:', msg);
                                    clearTimeout(authTimer);
                                    this.cleanupSocket(socket);
                                });
                                socket.on('close', () => {
                                    console.log('[McpGateway] MCP Server disconnected from pipe');
                                    clearTimeout(authTimer);
                                    this.cleanupSocket(socket);
                                });
                            });
                            server.once('error', (err) => {
                                server.close();
                                reject(err);
                            });
                            if (process.platform !== 'win32' && fs_1.default.existsSync(this.pipePath)) {
                                try {
                                    fs_1.default.unlinkSync(this.pipePath);
                                }
                                catch (err) { }
                            }
                            server.listen(this.pipePath, () => {
                                console.log(`[McpGateway] Listening on ${this.pipePath}`);
                                this.server = server;
                                this.updateStatus(true); // 🚀 サーバー起動時にフラグを有効化
                                server.removeAllListeners('error');
                                server.on('error', (err) => {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    console.error('[McpGateway] Server dynamic error:', msg);
                                    server.close(); // 🚀 リスナーを確実に閉じる
                                    if (this.server === server) {
                                        this.server = null;
                                    }
                                    this.updateStatus(false);
                                });
                                resolve();
                            });
                        });
                        return; // 成功
                    }
                    catch (err) {
                        if (err.code === 'EADDRINUSE' && i < 14) {
                            console.log(`[McpGateway] Pipe in use, retrying in ${delay}ms... (${i + 1}/15)`);
                            yield new Promise(r => setTimeout(r, delay));
                            delay = Math.min(delay * 1.5, 3000);
                            continue;
                        }
                        throw err;
                    }
                }
            });
            this.startingPromise = performStart();
            try {
                yield this.startingPromise;
            }
            finally {
                this.startingPromise = null;
            }
        });
    }
    /**
     * 外部プロセス (MCP Server) からのリクエストを React 側へ転送する。
     * 認証 (Layer B) は本関数の冒頭で行い、未認証ソケットからの非 auth メッセージは弾く。
     */
    handleMcpRequest(request, socket, authTimer) {
        // --- ガード処理: 停止中の場合はリクエストを拒否して切断 ---
        if (!this.mcpEnabled) {
            console.log('[McpGateway] MCP is disabled. Cleaning up socket.');
            this.cleanupSocket(socket);
            return;
        }
        const { id, method, params, auth } = request;
        // --- 認証ガード: 未認証ソケットの最初のメッセージは auth でなければならない ---
        if (!this.authenticatedSockets.has(socket)) {
            if (this.isAuthValid(auth)) {
                this.authenticatedSockets.add(socket);
                if (authTimer)
                    clearTimeout(authTimer);
                if (!socket.destroyed) {
                    socket.write(JSON.stringify({ id, result: { authenticated: true } }) + '\n');
                }
                return;
            }
            console.warn('[McpGateway] Authentication failed, closing socket');
            if (!socket.destroyed) {
                // socket.end(data) は data を流してから FIN を送る。socket.destroy だと
                // 直前の write が ack 前に切られて、クライアント側がエラー内容を観測できない
                // ことがある。end + close ハンドラで cleanupSocket は確実に呼ばれる。
                socket.end(JSON.stringify({ id, error: 'authentication required' }) + '\n');
            }
            return;
        }
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            if (!socket.destroyed) {
                socket.write(JSON.stringify({ id, error: 'Main window not available' }) + '\n');
            }
            return;
        }
        // --- タイムアウト管理 (30秒) ---
        // レンダラーがフリーズしたりクラッシュしたりした場合のメモリリークを防止。
        const timer = setTimeout(() => {
            const pending = this.pendingRequests.get(id);
            if (pending) {
                this.pendingRequests.delete(id);
                // タイムアウトした旨をソケットに返す（エラー返却）
                if (!socket.destroyed) {
                    socket.write(JSON.stringify({ id, error: 'Request to renderer timed out' }) + '\n');
                }
            }
        }, 30000);
        // レンダラーからの応答（mcp-response）があった際に、ソケット経由で返却を行うコールバック
        this.pendingRequests.set(id, {
            timer,
            socket,
            callback: (payload) => {
                if (!socket.destroyed) {
                    socket.write(JSON.stringify(Object.assign({ id }, payload)) + '\n');
                }
            }
        });
        // レンダラー（React 内の McpBridge.tsx）へ転送
        this.mainWindow.webContents.send('mcp-request', { id, method, params });
    }
    /**
     * レンダラーからの応答を受け取るための IPC ハンドラを登録する。
     */
    registerIpcHandlers() {
        if (this.mcpResponseHandler)
            return;
        this.mcpResponseHandler = (_event, response) => {
            const { id, result, error } = response;
            const pending = this.pendingRequests.get(id);
            if (pending) {
                clearTimeout(pending.timer);
                pending.callback({ result, error });
                this.pendingRequests.delete(id);
            }
            else {
                console.warn(`[McpGateway] Received mcp-response for unknown or timed-out request ID: ${id}`);
            }
        };
        electron_1.ipcMain.on('mcp-response', this.mcpResponseHandler);
    }
    /**
     * ソケットに関連するリソースを解放し、切断を確実に行う共通処理。
     */
    cleanupSocket(socket) {
        if (!this.activeSockets.has(socket))
            return;
        this.activeSockets.delete(socket);
        // このソケットに紐づく全ての保留中リクエストをクリーンアップ
        for (const [id, pending] of this.pendingRequests.entries()) {
            if (pending.socket === socket) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(id);
            }
        }
        if (!socket.destroyed) {
            socket.destroy();
        }
    }
    /**
     * MCP の稼働状態を更新し、レンダラーへ通知する。
     */
    updateStatus(enabled) {
        if (this.mcpEnabled === enabled)
            return;
        this.mcpEnabled = enabled;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('mcp-status-changed', enabled);
        }
    }
    /**
     * MCP サーバー（子プロセス）を起動する。
     * Named Pipe のリスニングもここで開始する。
     */
    startMcpProcess() {
        return __awaiter(this, void 0, void 0, function* () {
            // Pipe listen がまだなら開始（成功するまで、あるいはリトライ上限まで待機）
            try {
                yield this.startServer();
            }
            catch (err) {
                console.error('[McpGateway] Cannot start pipe server due to listen failure');
            }
        });
    }
    /**
     * MCP サーバー（子プロセス）を停止する。
     * Named Pipe のリスニングも停止する。
     */
    stopMcpProcess() {
        this.updateStatus(false); // 🚀 停止開始時に直ちにフラグを無効化し通知を送る
        // 1. サーバー（新規受付）とソケットの停止
        this.stopServer();
        // 2. 全てのアクティブなソケットを強制終了（既存の接続を絶つ）
        // cleanupSocket が activeSockets.delete(socket) を呼ぶため、コピーに対してループ
        for (const socket of Array.from(this.activeSockets)) {
            this.cleanupSocket(socket);
        }
        // 3. トークンを無効化: メモリ上のトークンを破棄し、ファイルも削除する。
        //    これで旧セッションのトークンを再利用したリプレイ接続は成立しない。
        this.currentToken = null;
        this.deleteTokenFile();
    }
    /**
     * Named Pipe サーバーを停止し、Unix ソケットファイルをクリーンアップする。
     */
    stopServer() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        // Unixソケットファイルのクリーンアップ
        if (process.platform !== 'win32' && fs_1.default.existsSync(this.pipePath)) {
            try {
                fs_1.default.unlinkSync(this.pipePath);
            }
            catch (err) { /* ignore */ }
        }
    }
    getStatus() {
        return this.mcpEnabled;
    }
    /**
     * 全てのリソースをクリーンアップし、サーバーを停止する。
     */
    dispose() {
        this.stopMcpProcess();
        // IPC ハンドラの登録解除
        if (this.mcpResponseHandler) {
            electron_1.ipcMain.removeListener('mcp-response', this.mcpResponseHandler);
            this.mcpResponseHandler = null;
        }
    }
}
exports.McpGateway = McpGateway;
exports.mcpGateway = new McpGateway();
