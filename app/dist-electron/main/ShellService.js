"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shellService = void 0;
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const iconv_lite_1 = __importDefault(require("iconv-lite"));
// プラットフォームに応じたシェルのエンコーディング
const SHELL_ENCODING = process.platform === 'win32' ? 'cp932' : 'utf8';
class ShellService {
    constructor() {
        this.shells = new Map();
    }
    init() {
        electron_1.ipcMain.handle('shell:start', (event, bufferId, cwd) => {
            var _a, _b;
            const isWin = process.platform === 'win32';
            const shellPath = isWin
                ? (process.env.COMSPEC || 'cmd.exe')
                : (process.env.SHELL || '/bin/sh');
            if (this.shells.has(bufferId)) {
                return true;
            }
            try {
                // Windows: cmd.exe /Q でコマンドエコーを抑制し、ユーザー入力の重複表示を防ぐ
                // (パイプ stdin の場合 echo on がデフォルトのため、明示的に切る)
                const shellArgs = isWin ? ['/Q'] : [];
                const shell = (0, child_process_1.spawn)(shellPath, shellArgs, {
                    cwd: cwd && cwd.trim() ? cwd : process.cwd(),
                    env: Object.assign({}, process.env),
                    windowsHide: true // 不要なウィンドウを表示させない
                });
                this.shells.set(bufferId, shell);
                (_a = shell.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (data) => {
                    if (event.sender.isDestroyed())
                        return;
                    const output = iconv_lite_1.default.decode(data, SHELL_ENCODING);
                    event.sender.send('shell:output', bufferId, output);
                });
                (_b = shell.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (data) => {
                    if (event.sender.isDestroyed())
                        return;
                    const output = iconv_lite_1.default.decode(data, SHELL_ENCODING);
                    event.sender.send('shell:output', bufferId, output);
                });
                shell.on('exit', (code) => {
                    this.shells.delete(bufferId);
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('shell:exit', bufferId);
                    }
                });
                shell.on('error', (err) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error(`[ShellService] Shell error for ${bufferId}:`, msg);
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('shell:output', bufferId, `\nError spawning shell: ${msg}\n`);
                    }
                });
                return true;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[ShellService] EXCEPTION starting shell for ${bufferId}:`, msg);
                return false;
            }
        });
        electron_1.ipcMain.handle('shell:input', (event, bufferId, input) => {
            const shell = this.shells.get(bufferId);
            if (shell && shell.stdin) {
                const lineEnding = process.platform === 'win32' ? '\r\n' : '\n';
                const encoded = iconv_lite_1.default.encode(input + lineEnding, SHELL_ENCODING);
                shell.stdin.write(encoded);
                return true;
            }
            console.warn(`[ShellService] No active shell found for ${bufferId} to send input`);
            return false;
        });
        electron_1.ipcMain.handle('shell:kill', (event, bufferId) => {
            const shell = this.shells.get(bufferId);
            if (shell) {
                shell.kill();
                this.shells.delete(bufferId);
                return true;
            }
            console.warn(`[ShellService] No shell found to kill for ${bufferId}`);
            return false;
        });
        // Emacs の C-c C-c 相当。実行中コマンドへの割り込み。
        // POSIX では SIGINT を送って sh/bash の foreground job を中断させる。
        // Windows の cmd.exe はパイプ stdin から signal を受け付けないため、
        // taskkill /T でプロセスツリーを終了させる (cmd.exe 自体も落ちるため
        // 呼び出し側は新規 shell の再起動を促す)。
        electron_1.ipcMain.handle('shell:interrupt', (event, bufferId) => {
            const shell = this.shells.get(bufferId);
            if (!shell) {
                console.warn(`[ShellService] No shell to interrupt for ${bufferId}`);
                return { ok: false, restartNeeded: false };
            }
            if (process.platform === 'win32') {
                try {
                    if (shell.pid) {
                        (0, child_process_1.spawn)('taskkill', ['/T', '/F', '/PID', String(shell.pid)], { windowsHide: true });
                    }
                    else {
                        shell.kill();
                    }
                }
                catch (err) {
                    console.error('[ShellService] taskkill failed:', err);
                    shell.kill();
                }
                return { ok: true, restartNeeded: true };
            }
            else {
                try {
                    shell.kill('SIGINT');
                    return { ok: true, restartNeeded: false };
                }
                catch (err) {
                    console.error('[ShellService] SIGINT failed:', err);
                    return { ok: false, restartNeeded: false };
                }
            }
        });
    }
    killAll() {
        for (const [id, shell] of this.shells) {
            shell.kill();
        }
        this.shells.clear();
    }
}
exports.shellService = new ShellService();
