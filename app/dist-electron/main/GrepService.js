"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grepService = void 0;
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const iconv_lite_1 = __importDefault(require("iconv-lite"));
class GrepService {
    constructor() {
        this.greps = new Map();
        // bufferId -> [data chunks]
        this.outputBuffers = new Map();
        this.throttleTimers = new Map();
    }
    init() {
        electron_1.ipcMain.handle('grep:start', (event, bufferId, directory, pattern, filePattern) => {
            var _a, _b;
            if (this.greps.has(bufferId)) {
                this.kill(bufferId);
            }
            try {
                let cmd;
                let args;
                // Smart-case: if pattern contains no uppercase letters, make search case-insensitive.
                const hasUpperCase = /[A-Z]/.test(pattern);
                if (process.platform === 'win32') {
                    cmd = 'findstr.exe';
                    // findstr /s /n /c:"pattern" "filePattern"
                    args = ['/s', '/n'];
                    if (!hasUpperCase)
                        args.push('/i');
                    args.push(`/c:${pattern}`);
                    args.push(filePattern);
                }
                else {
                    cmd = 'grep';
                    // grep -rn --include="filePattern" "pattern" "directory"
                    args = ['-rn'];
                    if (!hasUpperCase)
                        args.push('-i');
                    args.push(`--include=${filePattern}`);
                    args.push(pattern);
                    args.push(directory);
                }
                const grepProc = (0, child_process_1.spawn)(cmd, args, {
                    cwd: directory,
                    env: Object.assign({}, process.env),
                    windowsHide: true,
                    shell: false
                });
                this.greps.set(bufferId, grepProc);
                this.outputBuffers.set(bufferId, []);
                const sendOutput = () => {
                    const chunks = this.outputBuffers.get(bufferId);
                    if (chunks && chunks.length > 0) {
                        const data = chunks.join('');
                        this.outputBuffers.set(bufferId, []); // clear
                        if (!event.sender.isDestroyed()) {
                            event.sender.send('grep:output', bufferId, data);
                        }
                    }
                    this.throttleTimers.delete(bufferId);
                };
                const queueOutput = (data) => {
                    // Windows findstr outputs the raw bytes of the matching file.
                    // Since most modern source code is UTF-8, decode as UTF-8 globally to prevent mojibake.
                    const output = iconv_lite_1.default.decode(data, 'utf8');
                    const chunks = this.outputBuffers.get(bufferId) || [];
                    chunks.push(output);
                    this.outputBuffers.set(bufferId, chunks);
                    if (!this.throttleTimers.has(bufferId)) {
                        const timer = setTimeout(sendOutput, 50); // Throttle: 50ms
                        this.throttleTimers.set(bufferId, timer);
                    }
                };
                (_a = grepProc.stdout) === null || _a === void 0 ? void 0 : _a.on('data', queueOutput);
                (_b = grepProc.stderr) === null || _b === void 0 ? void 0 : _b.on('data', queueOutput);
                grepProc.on('exit', (code) => {
                    // Flush remaining output (timer pending or unqueued data)
                    if (this.throttleTimers.has(bufferId)) {
                        clearTimeout(this.throttleTimers.get(bufferId));
                    }
                    sendOutput();
                    this.greps.delete(bufferId);
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('grep:exit', bufferId);
                    }
                });
                grepProc.on('error', (err) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error(`[GrepService] Error spawning grep for ${bufferId}:`, msg);
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('grep:output', bufferId, `\nError running grep: ${msg}\n`);
                    }
                });
                return true;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[GrepService] EXCEPTION starting grep for ${bufferId}:`, msg);
                return false;
            }
        });
        electron_1.ipcMain.handle('grep:kill', (event, bufferId) => {
            return this.kill(bufferId);
        });
    }
    kill(bufferId) {
        const grepProc = this.greps.get(bufferId);
        if (grepProc) {
            grepProc.kill();
            this.greps.delete(bufferId);
            if (this.throttleTimers.has(bufferId)) {
                clearTimeout(this.throttleTimers.get(bufferId));
                this.throttleTimers.delete(bufferId);
            }
            this.outputBuffers.delete(bufferId);
            return true;
        }
        return false;
    }
    killAll() {
        for (const [id, grepProc] of this.greps) {
            grepProc.kill();
        }
        this.greps.clear();
        this.throttleTimers.forEach(timer => clearTimeout(timer));
        this.throttleTimers.clear();
        this.outputBuffers.clear();
    }
}
exports.grepService = new GrepService();
