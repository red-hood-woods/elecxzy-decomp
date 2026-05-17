"use strict";
/**
 * Windows-specific IME control module.
 * This module provides functionality to toggle IME state using Windows API via koffi (FFI).
 *
 * NOTE: This is Windows-specific code. On other platforms, these functions will be no-ops.
 * This file is kept separate to make it easy to remove or modify Windows-specific behavior.
 *
 * Uses koffi for FFI - no native compilation required, works out of the box.
 */
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
exports.toggleIme = toggleIme;
exports.setImeStatus = setImeStatus;
exports.setupImeHook = setupImeHook;
const electron_1 = require("electron");
let imm32 = null;
let ImmGetContext = null;
let ImmGetOpenStatus = null;
let ImmSetOpenStatus = null;
let ImmReleaseContext = null;
/**
 * Initialize FFI bindings for Windows IMM32 API.
 * Only initializes if on Windows platform.
 */
function initializeFFI() {
    if (process.platform !== 'win32') {
        return false;
    }
    if (imm32 !== null) {
        return true; // Already initialized
    }
    try {
        // Dynamic require to avoid issues on non-Windows platforms
        const koffi = require('koffi');
        // Load imm32.dll
        imm32 = koffi.load('imm32.dll');
        // Define IMM32 functions
        // HIMC ImmGetContext(HWND hWnd)
        ImmGetContext = imm32.func('uintptr_t ImmGetContext(uintptr_t hWnd)');
        // BOOL ImmGetOpenStatus(HIMC hIMC)
        ImmGetOpenStatus = imm32.func('int ImmGetOpenStatus(uintptr_t hIMC)');
        // BOOL ImmSetOpenStatus(HIMC hIMC, BOOL fOpen)
        ImmSetOpenStatus = imm32.func('int ImmSetOpenStatus(uintptr_t hIMC, int fOpen)');
        // BOOL ImmReleaseContext(HWND hWnd, HIMC hIMC)
        ImmReleaseContext = imm32.func('int ImmReleaseContext(uintptr_t hWnd, uintptr_t hIMC)');
        return true;
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[WindowsIme] Failed to initialize IMM32 FFI:', msg);
        return false;
    }
}
/**
 * Toggle IME state (ON ↔ OFF) by directly manipulating IMM32 context.
 * Uses koffi FFI for direct Windows API calls.
 *
 * @returns Promise<{ success: boolean, message: string }>
 */
function toggleIme() {
    return __awaiter(this, void 0, void 0, function* () {
        if (process.platform !== 'win32') {
            return { success: false, message: 'IME toggle is only supported on Windows' };
        }
        if (!initializeFFI()) {
            return { success: false, message: 'Failed to initialize Windows API bindings' };
        }
        try {
            // Get the handle of the focused window
            const focusedWindow = electron_1.BrowserWindow.getFocusedWindow();
            if (!focusedWindow) {
                return { success: false, message: 'No focused window found' };
            }
            const handleBuffer = focusedWindow.getNativeWindowHandle();
            const hwnd = handleBuffer.length === 8
                ? handleBuffer.readBigUInt64LE(0)
                : handleBuffer.readUInt32LE(0);
            // 1. Get IME Context
            const hIMC = ImmGetContext(hwnd);
            if (!hIMC) {
                return { success: false, message: 'Failed to get IME context' };
            }
            try {
                const currentStatus = ImmGetOpenStatus(hIMC);
                const newStatus = currentStatus === 0 ? 1 : 0;
                const result = ImmSetOpenStatus(hIMC, newStatus);
                if (result !== 0) {
                    const statusStr = newStatus !== 0 ? 'ON' : 'OFF';
                    return { success: true, message: `IME Toggled successfully via IMM32: ${statusStr}` };
                }
                else {
                    return { success: false, message: 'ImmSetOpenStatus failed' };
                }
            }
            finally {
                // 4. Release Context
                ImmReleaseContext(hwnd, hIMC);
            }
        }
        catch (error) {
            return { success: false, message: `Toggle failed: ${error}` };
        }
    });
}
/**
 * Set IME state (ON or OFF) by directly manipulating IMM32 context.
 *
 * @param open true to turn IME ON, false to turn IME OFF
 * @returns Promise<{ success: boolean, message: string }>
 */
function setImeStatus(open) {
    return __awaiter(this, void 0, void 0, function* () {
        if (process.platform !== 'win32') {
            return { success: false, message: 'IME control is only supported on Windows' };
        }
        if (!initializeFFI()) {
            return { success: false, message: 'Failed to initialize Windows API bindings' };
        }
        try {
            const focusedWindow = electron_1.BrowserWindow.getFocusedWindow();
            if (!focusedWindow) {
                return { success: false, message: 'No focused window found' };
            }
            const handleBuffer = focusedWindow.getNativeWindowHandle();
            const hwnd = handleBuffer.length === 8
                ? handleBuffer.readBigUInt64LE(0)
                : handleBuffer.readUInt32LE(0);
            const hIMC = ImmGetContext(hwnd);
            if (!hIMC) {
                return { success: false, message: 'Failed to get IME context' };
            }
            try {
                const newStatus = open ? 1 : 0;
                const result = ImmSetOpenStatus(hIMC, newStatus);
                if (result !== 0) {
                    const statusStr = open ? 'ON' : 'OFF';
                    return { success: true, message: `IME set to ${statusStr} successfully via IMM32` };
                }
                else {
                    return { success: false, message: 'ImmSetOpenStatus failed' };
                }
            }
            finally {
                ImmReleaseContext(hwnd, hIMC);
            }
        }
        catch (error) {
            return { success: false, message: `Set status failed: ${error}` };
        }
    });
}
/**
 * Setup a window message hook to detect IME status changes.
 *
 * @param mainWindow The Electron BrowserWindow to hook
 */
function setupImeHook(mainWindow) {
    if (process.platform !== 'win32')
        return;
    const handleBuffer = mainWindow.getNativeWindowHandle();
    const hwnd = handleBuffer.length === 8
        ? handleBuffer.readBigUInt64LE(0)
        : handleBuffer.readUInt32LE(0);
    // 🚀 共通の同期処理
    const syncState = () => {
        setImmediate(() => {
            if (mainWindow.isDestroyed())
                return;
            if (!initializeFFI())
                return; // 🚀 関数が定義されていることを確実にする
            const hIMC = ImmGetContext(hwnd);
            if (hIMC) {
                try {
                    const isImeOn = ImmGetOpenStatus(hIMC) !== 0;
                    mainWindow.webContents.send('ime-state-changed', isImeOn);
                }
                finally {
                    ImmReleaseContext(hwnd, hIMC);
                }
            }
        });
    };
    const WM_IME_NOTIFY = 0x0282;
    mainWindow.hookWindowMessage(WM_IME_NOTIFY, (wParam) => {
        try {
            const command = wParam.readUInt32LE(0);
            const IMN_SETOPENSTATUS = 0x0008;
            if (command === IMN_SETOPENSTATUS) {
                syncState();
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[WindowsIme] Hook error:', msg);
        }
    });
    // 🚀 ロード完了時とフォーカス時に同期を実行
    mainWindow.webContents.once('did-finish-load', syncState);
    mainWindow.on('focus', syncState);
}
