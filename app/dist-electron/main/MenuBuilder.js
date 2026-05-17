"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MenuBuilder = void 0;
const electron_1 = require("electron");
class MenuBuilder {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
    }
    buildMenu() {
        if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
            this.setupDevelopmentEnvironment();
        }
        const template = this.buildTemplate();
        const menu = electron_1.Menu.buildFromTemplate(template);
        electron_1.Menu.setApplicationMenu(menu);
        return menu;
    }
    setupDevelopmentEnvironment() {
        this.mainWindow.webContents.on('context-menu', (_, props) => {
            const { x, y } = props;
            electron_1.Menu.buildFromTemplate([
                {
                    label: 'Inspect element',
                    click: () => {
                        this.mainWindow.webContents.inspectElement(x, y);
                    },
                },
            ]).popup({ window: this.mainWindow });
        });
    }
    buildTemplate() {
        const isMac = process.platform === 'darwin';
        const template = [
            // File Menu
            {
                label: '&File',
                submenu: [
                    {
                        label: '&Open',
                        // accelerator: 'Ctrl+O', // Handled by editor (C-x C-f) or C-o (open-line)
                        click: () => {
                            this.mainWindow.webContents.send('menu-action', 'file:open');
                        }
                    },
                    {
                        label: '&Save',
                        // accelerator: 'Ctrl+S', // Handled by editor (C-x C-s) or C-s (isearch)
                        click: () => {
                            this.mainWindow.webContents.send('menu-action', 'file:save');
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Close Window Override',
                        accelerator: 'Ctrl+W',
                        click: () => {
                            this.mainWindow.webContents.send('menu-action', 'edit:kill-region');
                        },
                        visible: false
                    },
                    { role: 'quit' }
                ]
            },
            // Edit Menu
            {
                label: '&Edit',
                submenu: [
                    { role: 'undo' },
                    { role: 'redo' },
                    { type: 'separator' },
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'delete' },
                    { type: 'separator' },
                    { role: 'selectAll' }
                ]
            },
            // View Menu
            {
                label: '&View',
                submenu: [
                    { role: 'reload' },
                    { role: 'forceReload' },
                    ...(electron_1.app.isPackaged ? [] : [{
                            role: 'toggleDevTools',
                            accelerator: 'F12'
                        }]),
                    { type: 'separator' },
                    { role: 'resetZoom' },
                    { role: 'zoomIn' },
                    { role: 'zoomOut' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' }
                ]
            }
        ];
        return template;
    }
}
exports.MenuBuilder = MenuBuilder;
