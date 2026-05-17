"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    getFilePath: (file) => electron_1.webUtils.getPathForFile(file),
    openFile: () => electron_1.ipcRenderer.invoke('dialog:openFile'),
    showOpenDialog: (defaultPath) => electron_1.ipcRenderer.invoke('show-open-dialog', defaultPath),
    showOpenDirectoryDialog: (defaultPath) => electron_1.ipcRenderer.invoke('show-open-directory-dialog', defaultPath),
    showSaveDialog: (defaultPath) => electron_1.ipcRenderer.invoke('show-save-dialog', defaultPath),
    saveFile: (content, filePath, encoding) => electron_1.ipcRenderer.invoke('save-file', content, filePath, encoding),
    readFile: (filePath) => electron_1.ipcRenderer.invoke('read-file', filePath),
    readDirectory: (dirPath) => electron_1.ipcRenderer.invoke('read-directory', dirPath),
    readSidebarTree: (dirPath) => electron_1.ipcRenderer.invoke('read-sidebar-tree', dirPath),
    getUserHome: () => electron_1.ipcRenderer.invoke('get-user-home'),
    getConfig: () => electron_1.ipcRenderer.invoke('config:get'),
    getConfigPath: () => electron_1.ipcRenderer.invoke('config:getPath'),
    saveConfig: (config) => electron_1.ipcRenderer.invoke('config:save', config),
    getKeybinds: () => electron_1.ipcRenderer.invoke('keybinds:get'),
    getKeybindsPath: () => electron_1.ipcRenderer.invoke('keybinds:getPath'),
    ensureKeybindsFile: () => electron_1.ipcRenderer.invoke('keybinds:ensure'),
    getSystemFonts: () => electron_1.ipcRenderer.invoke('get-system-fonts'),
    getFileStat: (filePath) => electron_1.ipcRenderer.invoke('get-file-stat', filePath),
    claimFileExclusive: (filePath) => electron_1.ipcRenderer.invoke('claim-file-exclusive', filePath),
    releaseEmptyFile: (filePath) => electron_1.ipcRenderer.invoke('release-empty-file', filePath),
    deleteItem: (itemPath) => electron_1.ipcRenderer.invoke('delete-item', itemPath),
    createNewFile: (filePath) => electron_1.ipcRenderer.invoke('create-new-file', filePath),
    createNewDirectory: (dirPath) => electron_1.ipcRenderer.invoke('create-new-directory', dirPath),
    renameItem: (oldPath, newPath) => electron_1.ipcRenderer.invoke('rename-item', oldPath, newPath),
    getWorkingDirectory: () => electron_1.ipcRenderer.invoke('get-working-directory'),
    onMenuAction: (callback) => {
        const subscription = (_event, action) => callback(action);
        electron_1.ipcRenderer.on('menu-action', subscription);
        return () => electron_1.ipcRenderer.removeListener('menu-action', subscription);
    },
    getAppInfo: () => electron_1.ipcRenderer.invoke('get-app-info'),
    getLicenseContent: () => electron_1.ipcRenderer.invoke('get-license-content'),
    getCommandListContent: () => electron_1.ipcRenderer.invoke('get-command-list-content'),
    readWorkspaceFile: (filePath) => electron_1.ipcRenderer.invoke('read-workspace-file', filePath),
    saveWorkspaceFile: (filePath, folders) => electron_1.ipcRenderer.invoke('save-workspace-file', filePath, folders),
    updateWorkspaceWatchers: (folders) => electron_1.ipcRenderer.send('update-workspace-watchers', folders),
    updateExplorerWatcher: (path) => electron_1.ipcRenderer.send('update-explorer-watcher', path),
    // 外部変更検知 (auto-revert) — 開いているバッファのファイルパス全集合を main へ送る。
    updateBufferWatchers: (filePaths) => electron_1.ipcRenderer.send('update-buffer-watchers', filePaths),
    onBufferFileChanged: (callback) => {
        const subscription = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('buffer-file-changed', subscription);
        return () => electron_1.ipcRenderer.removeListener('buffer-file-changed', subscription);
    },
    resolvePath: (path) => electron_1.ipcRenderer.invoke('resolve-path', path),
    // Windows-specific IME toggle (C-\ command)
    toggleIme: () => electron_1.ipcRenderer.invoke('toggle-ime'),
    setImeStatus: (open) => electron_1.ipcRenderer.invoke('set-ime-status', open),
    onOpenFile: (callback) => {
        const subscription = (_event, filePath) => callback(filePath);
        electron_1.ipcRenderer.on('open-file', subscription);
        return () => electron_1.ipcRenderer.removeListener('open-file', subscription);
    },
    notifyRendererReady: () => electron_1.ipcRenderer.send('renderer-ready'),
    onGlobalKeyDown: (callback) => {
        const subscription = (_event, input) => callback(input);
        electron_1.ipcRenderer.on('global-keydown', subscription);
        return () => electron_1.ipcRenderer.removeListener('global-keydown', subscription);
    },
    setPrefixState: (state) => electron_1.ipcRenderer.send('set-prefix-state', state),
    getColorConfig: () => electron_1.ipcRenderer.invoke('get-color-config'),
    saveColorConfig: (config) => electron_1.ipcRenderer.invoke('save-color-config', config),
    getColorConfigPath: () => electron_1.ipcRenderer.invoke('get-color-config-path'),
    // Window Closing Handling
    onAppCloseRequest: (callback) => {
        const subscription = () => callback();
        electron_1.ipcRenderer.on('app-close-request', subscription);
        return () => electron_1.ipcRenderer.removeListener('app-close-request', subscription);
    },
    confirmQuit: () => electron_1.ipcRenderer.send('confirm-quit'),
    // Shell Mode IPC
    shellStart: (bufferId, cwd) => electron_1.ipcRenderer.invoke('shell:start', bufferId, cwd),
    shellInput: (bufferId, input) => electron_1.ipcRenderer.invoke('shell:input', bufferId, input),
    shellKill: (bufferId) => electron_1.ipcRenderer.invoke('shell:kill', bufferId),
    shellInterrupt: (bufferId) => electron_1.ipcRenderer.invoke('shell:interrupt', bufferId),
    onShellOutput: (callback) => {
        const subscription = (_event, bufferId, output) => callback(bufferId, output);
        electron_1.ipcRenderer.on('shell:output', subscription);
        return () => electron_1.ipcRenderer.removeListener('shell:output', subscription);
    },
    onShellExit: (callback) => {
        const subscription = (_event, bufferId) => callback(bufferId);
        electron_1.ipcRenderer.on('shell:exit', subscription);
        return () => electron_1.ipcRenderer.removeListener('shell:exit', subscription);
    },
    // Grep Mode IPC
    grepStart: (bufferId, directory, pattern, filePattern) => electron_1.ipcRenderer.invoke('grep:start', bufferId, directory, pattern, filePattern),
    grepKill: (bufferId) => electron_1.ipcRenderer.invoke('grep:kill', bufferId),
    onGrepOutput: (callback) => {
        const subscription = (_event, bufferId, output) => callback(bufferId, output);
        electron_1.ipcRenderer.on('grep:output', subscription);
        return () => electron_1.ipcRenderer.removeListener('grep:output', subscription);
    },
    onGrepExit: (callback) => {
        const subscription = (_event, bufferId) => callback(bufferId);
        electron_1.ipcRenderer.on('grep:exit', subscription);
        return () => electron_1.ipcRenderer.removeListener('grep:exit', subscription);
    },
    // MCP Gateway IPC
    onMcpRequest: (callback) => {
        const subscription = (_event, request) => callback(request);
        electron_1.ipcRenderer.on('mcp-request', subscription);
        return () => electron_1.ipcRenderer.removeListener('mcp-request', subscription);
    },
    sendMcpResponse: (response) => electron_1.ipcRenderer.send('mcp-response', response),
    startMcp: () => electron_1.ipcRenderer.invoke('mcp:start'),
    stopMcp: () => electron_1.ipcRenderer.invoke('mcp:stop'),
    getMcpStatus: () => electron_1.ipcRenderer.invoke('mcp:status'),
    onMcpStatusChanged: (callback) => {
        const subscription = (_event, status) => callback(status);
        electron_1.ipcRenderer.on('mcp-status-changed', subscription);
        return () => electron_1.ipcRenderer.removeListener('mcp-status-changed', subscription);
    },
    onImeStateChanged: (callback) => {
        const subscription = (_event, isImeOn) => callback(isImeOn);
        electron_1.ipcRenderer.on('ime-state-changed', subscription);
        return () => electron_1.ipcRenderer.removeListener('ime-state-changed', subscription);
    },
    onWorkspaceFileChanged: (callback) => {
        const subscription = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('workspace-file-changed', subscription);
        return () => electron_1.ipcRenderer.removeListener('workspace-file-changed', subscription);
    },
    onExplorerFileChanged: (callback) => {
        const subscription = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('explorer-file-changed', subscription);
        return () => electron_1.ipcRenderer.removeListener('explorer-file-changed', subscription);
    },
    pathSeparator: process.platform === 'win32' ? '\\' : '/',
});
