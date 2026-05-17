"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMcpServer = runMcpServer;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const net_1 = __importDefault(require("net"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const MCP_VERSION = "0.7.3";
// IPC Config
const PIPE_PATH = process.platform === 'win32'
    ? '\\\\.\\pipe\\elecxzy-mcp'
    : path_1.default.join(process.env.TMPDIR || '/tmp', 'elecxzy-mcp.sock');
// Auth token: elecxzy main writes this on mcp-start to userData/.mcp-token.
// We re-read on every (re)connect so token rotation across mcp-start/stop cycles
// is handled transparently. ELECXZY_MCP_TOKEN_PATH overrides; otherwise we try
// the packaged-install path first and fall back to the dev path (`elecxzy-dev`)
// so a developer doing `npm start` can connect their MCP client without extra
// config. Both paths live under the user's per-account profile directory, so
// trying more than one does not widen the trust boundary.
function getTokenPaths() {
    if (process.env.ELECXZY_MCP_TOKEN_PATH)
        return [process.env.ELECXZY_MCP_TOKEN_PATH];
    let appData;
    if (process.platform === 'win32') {
        appData = process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming');
    }
    else if (process.platform === 'darwin') {
        appData = path_1.default.join(os_1.default.homedir(), 'Library', 'Application Support');
    }
    else {
        appData = path_1.default.join(os_1.default.homedir(), '.config');
    }
    return [
        path_1.default.join(appData, 'elecxzy', '.mcp-token'),
        path_1.default.join(appData, 'elecxzy-dev', '.mcp-token'),
    ];
}
const AUTH_TIMEOUT_MS = 5000;
function readAuthToken() {
    const paths = getTokenPaths();
    let lastErr = null;
    for (const p of paths) {
        try {
            const content = fs_1.default.readFileSync(p, 'utf-8').trim();
            if (content)
                return { token: content, source: p };
        }
        catch (err) {
            lastErr = err;
        }
    }
    const tried = paths.join(', ');
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`Failed to read MCP auth token (tried: ${tried}): ${detail}. Is elecxzy MCP enabled (M-x mcp-start)?`);
}
/**
 * MCP ツール定義のリスト
 * 保守性向上のため、ハードコードされたメソッド呼び出しから分離。
 */
const TOOLS = [
    {
        name: "save_file",
        description: "Save the current active buffer to a specified file path. Security: You CANNOT overwrite pre-existing files via MCP. You can only save to a NEW path (creation) or overwrite files that were newly created during the CURRENT session.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to save to. Must be a NEW file or a file already created during this session." }
            },
            required: ["path"]
        }
    },
    {
        name: "read_buffer",
        description: "Read the content of an active or background buffer. Returns the current text in the editor's memory, including unsaved changes. For large files, it is highly recommended to perform updates using replace_buffer_lines (partial replacement) rather than overwriting the entire content. Use startLine and endLine to read specific sections of large files. If startLine is omitted, it defaults to 1. If endLine is omitted, it defaults to the last line.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Optional: File path of the buffer to read. If omitted, reads the current active buffer." },
                startLine: { type: "number", description: "Optional: 1-indexed starting line to read. If omitted, defaults to 1." },
                endLine: { type: "number", description: "Optional: 1-indexed ending line to read (inclusive). If omitted, defaults to the last line." }
            }
        }
    },
    {
        name: "get_cursor",
        description: "Get the current cursor position in the active buffer. Returns line (1-indexed), col (1-indexed), and raw character offset.",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "set_cursor",
        description: "Moves the cursor to a specific line and column. Both line and col are 1-indexed (the first character of the first line is line=1, col=1). If both are omitted, no changes are made. Moving the cursor after setting a mark (via region_action) implicitly defines the 'active region' for subsequent region operations.",
        inputSchema: {
            type: "object",
            properties: {
                line: {
                    type: "number",
                    description: "The target line number (1-indexed, starting from 1). A negative number (e.g., -1) targets the last line of the buffer. 0 is treated as the beginning of the buffer."
                },
                col: {
                    type: "number",
                    description: "The target column number (1-indexed, starting from 1). A negative number (e.g., -1) targets the end of the line (at the newline character if present). 0 is treated as the beginning of the line. If omitted, defaults to 1 (beginning of the line)."
                }
            }
        }
    },
    {
        name: "move_cursor",
        description: "Moves the cursor relative to its current position by a specified character offset.",
        inputSchema: {
            type: "object",
            properties: {
                offset: {
                    type: "number",
                    description: "The number of characters to move. A positive value moves the cursor forward (towards the end of the buffer), while a negative value moves it backward (towards the beginning)."
                }
            },
            required: ["offset"]
        }
    },
    {
        name: "window_action",
        description: "Perform window or layout actions (split, focus switch, resize, etc.).",
        inputSchema: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["split-window-below", "split-window-right", "delete-window", "other-window", "switch-to-buffer", "resize"],
                    description: "The action to perform"
                },
                target: { type: "string", description: "Mandatory for 'switch-to-buffer': Name of the buffer to switch to." },
                weight: { type: "number", description: "Mandatory for 'resize': The new display weight (relative size ratio) for the window." },
                windowId: { type: "string", description: "Optional for 'resize': The ID of the window to resize. Defaults to the active window." }
            },
            anyOf: [
                {
                    properties: { action: { enum: ["switch-to-buffer"] } },
                    required: ["action", "target"]
                },
                {
                    properties: { action: { enum: ["resize"] } },
                    required: ["action", "weight"]
                },
                {
                    properties: { action: { enum: ["split-window-below", "split-window-right", "delete-window", "other-window"] } },
                    required: ["action"]
                }
            ]
        }
    },
    {
        name: "insert_string",
        description: "Insert text at the current cursor position in the active buffer.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "The text to insert" }
            },
            required: ["text"]
        }
    },
    {
        name: "delete_string",
        description: "Delete a specified number of characters from the current cursor position in the active buffer. If 'count' is positive, it deletes characters starting FROM the cursor position towards the end of the file (equivalent to pressing 'Delete' multiple times). If 'count' is negative, it deletes characters BEFORE the cursor position (equivalent to pressing 'Backspace' multiple times). Example: count=5 deletes 5 characters forward, count=-5 deletes 5 characters backward.",
        inputSchema: {
            type: "object",
            properties: {
                count: {
                    type: "number",
                    description: "Number of characters to delete. Positive for forward, negative for backward."
                }
            },
            required: ["count"]
        }
    },
    {
        name: "replace_buffer_lines",
        description: "Edit a specific range of lines in the active buffer. Replaces lines from startLine to endLine (inclusive, 1-based) with newText. NOTE: This replaces the raw text range including the trailing newline of endLine. If newText does not end with a newline, the subsequent line will be merged. Both startLine and endLine must be within current line count. Defaults: startLine=1, endLine=last line.",
        inputSchema: {
            type: "object",
            properties: {
                startLine: { type: "number", description: "Optional: 1-based starting line number to replace. If omitted, defaults to 1." },
                endLine: { type: "number", description: "Optional: 1-based ending line number to replace. If omitted, defaults to the last line." },
                newText: { type: "string", description: "New text to insert. Include a trailing newline if you want to keep the next line separate." },
                path: { type: "string", description: "Optional: File path. If omitted, targets the active buffer." }
            },
            required: ["newText"]
        }
    },
    {
        name: "replace_string",
        description: "Replace occurrences of a target string with a replacement string in the active buffer. Matches are searched starting from the current cursor position to the end of the buffer. If the target string contains at least one uppercase letter, the search is case-sensitive (smart-case search).",
        inputSchema: {
            type: "object",
            properties: {
                target: { type: "string", description: "The string to search for." },
                replacement: { type: "string", description: "The string to replace with." }
            },
            required: ["target", "replacement"]
        }
    },
    {
        name: "search_buffer",
        description: "Search for a string or regex in the buffer and return matching lines. Standard JS regex is used. To enable case-insensitive search, prepend '(?i)'. Other inline flags like '(?m)' or '(?-i)' are NOT supported.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "String or Regex to search for" },
                isRegex: { type: "boolean", description: "Set to true if query is a regular expression" },
                path: { type: "string", description: "Optional: File path." }
            },
            required: ["query"]
        }
    },
    {
        name: "list_buffers",
        description: "List all open user buffers, showing their path, read-only status, and modified status. Excludes special system buffers.",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "get_line_count",
        description: "Get the total number of lines in a buffer.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Optional: File path. If omitted, targets the active buffer." }
            }
        }
    },
    {
        name: "get_window_layout",
        description: "Get the window layout tree. Each 'leaf' node (pane) includes 'id', 'isActive', 'bufferName', 'bufferPath', and 'weight'. Internal nodes show how windows are split (horizontal/vertical).",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "set_display_config",
        description: "Adjust editor appearance: font family or font size.",
        inputSchema: {
            type: "object",
            properties: {
                fontFamily: { type: "string", description: "e.g., 'JetBrains Mono', 'Fira Code'" },
                fontSize: { type: "number", description: "Font size in pixels (e.g., 14, 18)" }
            }
        }
    },
    {
        name: "access_register",
        description: "Interact with Emacs-style registers (persistent memory slots named by a single character). Use this to STORE or RETRIEVE text or cursor positions across different buffers. To STORE: provide both 'register' (e.g., 'a') and 'text'. To READ: provide only 'register'.",
        inputSchema: {
            type: "object",
            properties: {
                register: { type: "string", description: "Single char register name (e.g., 'a', '1', 'z')" },
                text: { type: "string", description: "The content to store in this slot. If omitted, the tool returns the current content of the register." }
            },
            required: ["register"]
        }
    },
    {
        name: "kill_ring_action",
        description: "Interact with the kill-ring (Emacs's advanced clipboard history).",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["append", "peek", "rotate"], description: "Action to perform on the kill-ring" },
                text: { type: "string", description: "Required ONLY if action is 'append': The string to add to the clipboard history." }
            },
            anyOf: [
                {
                    properties: { action: { enum: ["append"] } },
                    required: ["action", "text"]
                },
                {
                    properties: { action: { enum: ["peek", "rotate"] } },
                    required: ["action"]
                }
            ]
        }
    },
    {
        name: "region_action",
        description: "Executes operations on the active 'region' (between 'mark' and 'cursor').",
        inputSchema: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["comment", "uncomment", "indent", "indent-rigidly", "set-mark", "kill-region"],
                    description: "The Emacs-style action to perform."
                },
                arg: { type: "number", description: "Numeric arg. Required for 'indent-rigidly' (defines shift width)." }
            },
            anyOf: [
                {
                    properties: { action: { enum: ["indent-rigidly"] } },
                    required: ["action", "arg"]
                },
                {
                    properties: { action: { enum: ["comment", "uncomment", "indent", "set-mark", "kill-region"] } },
                    required: ["action"]
                }
            ]
        }
    },
    {
        name: "set_buffer_mode",
        description: "Manually set the major mode for syntax highlighting in the current buffer.",
        inputSchema: {
            type: "object",
            properties: {
                mode: { type: "string", description: "Mode name (e.g., 'typescript', 'markdown', 'python', 'css')" }
            },
            required: ["mode"]
        }
    },
    {
        name: "get_buffer_config",
        description: "Get the current buffer's encoding, line terminator (LF/CRLF), and line number visibility.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Optional: File path. If omitted, uses active buffer." }
            }
        }
    },
    {
        name: "set_buffer_config",
        description: "Update buffer metadata or editor UI. You can provide ONE or MORE properties simultaneously in a single call (e.g., both encoding and lineTerminator).",
        inputSchema: {
            type: "object",
            properties: {
                encoding: { type: "string", enum: ["utf-8", "shift-jis", "euc-jp"], description: "Set character encoding" },
                lineTerminator: { type: "string", enum: ["LF", "CRLF"], description: "Set line terminator" },
                lineNumbers: { type: "boolean", description: "Set true to show line numbers, false to hide" },
                fontFamily: { type: "string", description: "e.g., 'JetBrains Mono', 'Fira Code'" },
                fontSize: { type: "number", description: "Font size in pixels (e.g., 14, 18)" }
            },
            anyOf: [
                { required: ["encoding"] },
                { required: ["lineTerminator"] },
                { required: ["lineNumbers"] },
                { required: ["fontFamily"] },
                { required: ["fontSize"] }
            ]
        }
    },
    {
        name: "mark_whole_buffer",
        description: "Select the entire content of the current buffer. This sets the mark at the beginning and the cursor at the end.",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "sort_lines",
        description: "Sorts the lines in the active region (between mark and cursor). Equivalent to M-x sort-lines (reverse=false) or C-u M-x sort-lines (reverse=true). If no region is active, this operation does nothing.",
        inputSchema: {
            type: "object",
            properties: {
                reverse: { type: "boolean", description: "If true, sorts in descending order (reverse alphabetical). Defaults to false." }
            }
        }
    },
    {
        name: "set_cursor_vfx",
        description: "Set cursor particle VFX effect. You can pass 'off' to disable it. Effect names are case-insensitive.",
        inputSchema: {
            type: "object",
            properties: {
                effect: {
                    type: "string",
                    description: "VFX effect name. Choices: 'off', 'Light Particle', 'Cyber Trace', 'Prismatic Nova', 'Arcane Sigil', 'Inferno Flame', 'Phantom Merge', 'Rubber Slime', 'Quantum Tunnel', 'Kawaii Shower'."
                }
            },
            required: ["effect"]
        }
    }
];
class ElecxzyMcpServer {
    server;
    client = null;
    connectionPromise = null;
    pendingRequests = new Map();
    constructor() {
        this.server = new index_js_1.Server({
            name: "elecxzy-editor",
            version: MCP_VERSION,
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupTools();
    }
    /**
     * シングルトン的に IPC 接続を確立・取得する。
     * 複数の呼び出しが重なっても一件の接続のみが行われることを保証。
     */
    async getClient() {
        if (this.client && !this.client.destroyed)
            return this.client;
        // 接続中の場合はその Promise を待機
        if (this.connectionPromise)
            return this.connectionPromise;
        this.connectionPromise = this.connectToElectron();
        try {
            this.client = await this.connectionPromise;
            return this.client;
        }
        finally {
            this.connectionPromise = null;
        }
    }
    async connectToElectron() {
        return new Promise((resolve, reject) => {
            const socket = net_1.default.createConnection(PIPE_PATH, () => {
                console.error('[MCP Server] Connected to elecxzy pipe');
                // 接続確立後は接続後用のエラーハンドラに差し替える。
                // 接続前のハンドラは既に resolve 済みの Promise に reject を呼ぶだけで無効なため、
                // 接続後のエラーは適切にログ出力するハンドラへ置き換える。
                socket.removeAllListeners('error');
                socket.on('error', (err) => {
                    console.error('[MCP Server] Socket error after connection:', err);
                    // クリーンアップは続いて発火する close イベントに委譲する
                });
                let buffer = '';
                socket.on('data', (data) => {
                    buffer += data.toString();
                    const parts = buffer.split('\n');
                    buffer = parts.pop() || '';
                    for (const part of parts) {
                        if (!part.trim())
                            continue;
                        try {
                            const response = JSON.parse(part);
                            const pending = this.pendingRequests.get(response.id);
                            if (pending) {
                                this.pendingRequests.delete(response.id);
                                if (response.error)
                                    pending.reject(new Error(response.error));
                                else
                                    pending.resolve(response.result);
                            }
                        }
                        catch (e) {
                            console.error('[MCP Server] Failed to parse response from elecxzy:', e);
                        }
                    }
                });
                // 接続できたら最初に認証を行い、auth が成功したら resolve する。
                // - トークンファイルはセッションごとに rotate されるため、毎回 (再接続のたびに)
                //   読み直す。キャッシュしない。
                // - 認証が失敗 / タイムアウトした場合はソケットを閉じて reject。
                this.authenticate(socket)
                    .then(() => resolve(socket))
                    .catch((err) => {
                    socket.destroy();
                    reject(err);
                });
            });
            // 接続試行中のエラーハンドラ（接続確立前の失敗のみ担当）
            socket.on('error', (err) => {
                reject(new Error(`Failed to connect to elecxzy at ${PIPE_PATH}: ${err.message}. Is the editor running?`));
            });
            socket.on('close', () => {
                if (this.client === socket) {
                    this.client = null;
                    // 全ての保留中リクエストをエラーとして終了させる（エディタ終了時の待機回避）
                    const error = new Error("Connection to editor closed unexpectedly");
                    for (const pending of this.pendingRequests.values()) {
                        pending.reject(error);
                    }
                    this.pendingRequests.clear();
                }
            });
        });
    }
    /**
     * Send the session token as the first message after connect, and wait for
     * the server's `{ result: { authenticated: true } }` ack. The token is read
     * fresh from disk each call so a mcp-stop / mcp-start cycle on the editor
     * side is handled transparently — we never reuse a stale token.
     */
    async authenticate(socket) {
        const { token, source } = readAuthToken();
        console.error(`[MCP Server] Using auth token from ${source}`);
        const authId = crypto_1.default.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.delete(authId)) {
                    reject(new Error('MCP auth response timed out'));
                }
            }, AUTH_TIMEOUT_MS);
            this.pendingRequests.set(authId, {
                resolve: () => { clearTimeout(timer); resolve(); },
                reject: (err) => { clearTimeout(timer); reject(err); },
            });
            const payload = JSON.stringify({ id: authId, auth: token }) + '\n';
            socket.write(payload, (err) => {
                if (err) {
                    clearTimeout(timer);
                    this.pendingRequests.delete(authId);
                    reject(err);
                }
            });
        });
    }
    async callElectron(method, params) {
        const socket = await this.getClient();
        const id = crypto_1.default.randomUUID();
        return new Promise((resolve, reject) => {
            const timeoutTimer = setTimeout(() => {
                const pending = this.pendingRequests.get(id);
                if (pending) {
                    this.pendingRequests.delete(id);
                    pending.reject(new Error(`Request ${method} timed out`));
                }
            }, 30000);
            const cleanResolve = (val) => {
                clearTimeout(timeoutTimer);
                resolve(val);
            };
            const cleanReject = (err) => {
                clearTimeout(timeoutTimer);
                reject(err);
            };
            this.pendingRequests.set(id, { resolve: cleanResolve, reject: cleanReject });
            const request = JSON.stringify({ id, method, params }) + '\n';
            socket.write(request, (err) => {
                if (err) {
                    this.pendingRequests.delete(id);
                    cleanReject(err);
                }
            });
        });
    }
    setupTools() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
            tools: TOOLS
        }));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            try {
                const result = await this.callElectron(request.params.name, request.params.arguments);
                // 結果が undefined / null の場合は成功メッセージを返し、そうでなければ JSON 文字列化。
                const safeText = result !== undefined && result !== null
                    ? (typeof result === 'string' ? result : JSON.stringify(result, null, 2))
                    : "Operation completed successfully";
                return {
                    content: [{ type: "text", text: safeText }]
                };
            }
            catch (error) {
                return {
                    isError: true,
                    content: [{ type: "text", text: error.message || "Unknown error occurred" }]
                };
            }
        });
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error("[MCP Server] Running on stdio");
    }
}
async function runMcpServer() {
    const server = new ElecxzyMcpServer();
    try {
        await server.run();
    }
    catch (err) {
        console.error("[MCP Server] Fatal error:", err);
        process.exit(1);
    }
}
if (require.main === module) {
    runMcpServer();
}
