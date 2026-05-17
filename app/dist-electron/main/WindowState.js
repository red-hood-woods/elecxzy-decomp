"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WindowStateManager = void 0;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const atomicWrite_1 = require("./atomicWrite");
const STATE_FILE = 'window-state.json';
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 768;
class WindowStateManager {
    constructor() {
        this.saveTimeout = null;
        this.path = path_1.default.join(electron_1.app.getPath('userData'), STATE_FILE);
        this.state = {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            isMaximized: false
        };
    }
    load() {
        try {
            if (fs_1.default.existsSync(this.path)) {
                const data = fs_1.default.readFileSync(this.path, 'utf-8');
                const loaded = JSON.parse(data);
                this.state = this.validateState(loaded);
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to load window state:', msg);
        }
        return this.state;
    }
    save(window, force = false) {
        if (!window || window.isDestroyed())
            return;
        // Update internal state immediately
        try {
            const isMaximized = window.isMaximized();
            if (isMaximized) {
                this.state.isMaximized = true;
            }
            else {
                const bounds = window.getBounds();
                this.state = {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    isMaximized: false
                };
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to update window state:', msg);
            return;
        }
        // Handle disk write with debounce/force
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        if (force) {
            try {
                (0, atomicWrite_1.writeFileAtomicSync)(this.path, JSON.stringify(this.state));
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('Failed to save window state (force):', msg);
            }
        }
        else {
            this.saveTimeout = setTimeout(() => {
                this.saveTimeout = null;
                try {
                    (0, atomicWrite_1.writeFileAtomicSync)(this.path, JSON.stringify(this.state));
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error('Failed to save window state during timeout:', msg);
                }
            }, 500);
        }
    }
    validateState(loaded) {
        const isValid = (Number.isInteger(loaded.width) && loaded.width > 0 &&
            Number.isInteger(loaded.height) && loaded.height > 0);
        if (!isValid) {
            return {
                width: DEFAULT_WIDTH,
                height: DEFAULT_HEIGHT,
                isMaximized: false
            };
        }
        // Validate position is within some display
        if (Number.isInteger(loaded.x) && Number.isInteger(loaded.y)) {
            const displays = electron_1.screen.getAllDisplays();
            const visible = displays.some(display => {
                const bounds = display.bounds;
                return (loaded.x >= bounds.x &&
                    loaded.x < bounds.x + bounds.width &&
                    loaded.y >= bounds.y &&
                    loaded.y < bounds.y + bounds.height);
            });
            if (!visible) {
                // Reset position if off-screen
                return {
                    width: loaded.width,
                    height: loaded.height,
                    isMaximized: loaded.isMaximized || false
                };
            }
        }
        return {
            x: loaded.x,
            y: loaded.y,
            width: loaded.width,
            height: loaded.height,
            isMaximized: loaded.isMaximized || false
        };
    }
}
exports.WindowStateManager = WindowStateManager;
