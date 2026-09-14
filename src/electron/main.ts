import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Both playback windows must retain their renderer priority when focus moves between them.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-media-suspend');
if (process.platform === 'win32') app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let mainWindow: BrowserWindow | null = null;
let shutdown: (() => Promise<void>) | undefined, quitting = false;
if (!app.requestSingleInstanceLock()) { console.error('FAILED TO ACQUIRE SINGLE INSTANCE LOCK'); app.quit(); }
else {
  app.on('second-instance', () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.focus(); });
  void app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';
    mainWindow = new BrowserWindow({
      width: 1440, height: 1000, minWidth: 760, minHeight: 600, backgroundColor: '#0c0e14', autoHideMenuBar: true,
      ...(isMac ? { titleBarStyle: 'hiddenInset' } : isWin ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0c0e14', symbolColor: '#f9fafb', height: 44 } } : {}),
      webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
    await mainWindow.loadFile(fileURLToPath(new URL('../web/startup.html', import.meta.url)));

    // Keep server modules (including Express and Multer) off the critical path
    // until Chromium has painted a responsive startup window.
    const [{ createApp, listen, listenAvailable, serverPort, serverUrl, closeServer }, { MediaTools }] = await Promise.all([
      import('../server/app.js'), import('../server/media.js')
    ]);
    const settingsPath = path.join(app.getPath('userData'), 'library-location.json');
    let folder = path.join(app.getPath('documents'), 'Karaoke', 'songs');
    try { const saved = JSON.parse(await readFile(settingsPath, 'utf8')); if (typeof saved.folder === 'string') folder = saved.folder; } catch { /* First launch uses Documents. */ }
    const arg = process.argv.indexOf('--library');
    if (arg >= 0) {
      const next = process.argv[arg + 1];
      if (next && !next.startsWith('-')) folder = path.resolve(next);
      else {
        const positional = process.argv.filter(a => !a.startsWith('-') && a !== '.' && !a.includes('loader.js') && !a.includes('electron'));
        if (positional.length) folder = path.resolve(positional[positional.length - 1]);
      }
    }
    const binary = (name: string) => {
      const filename = name + (process.platform === 'win32' ? '.exe' : '');
      const bundled = path.join(process.resourcesPath, 'media-tools', filename);
      return existsSync(bundled) ? bundled : process.env[name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'] || name;
    };
    const openLibrary = (folder: string) => createApp(folder, { webRoot: fileURLToPath(new URL('../web', import.meta.url)), media: new MediaTools(binary('ffmpeg'), binary('ffprobe')) });
    let service = await openLibrary(folder);
    // Stable port preserves the browser-origin preferences between desktop launches.
    let server = await listenAvailable(service.app).catch(async error => { await service.store.close(); throw error; });
    const activePort = serverPort(server);
    shutdown = async () => { await closeServer(server); await service.store.close(); };
    const origin = serverUrl(server);
    if (!mainWindow) { await shutdown(); shutdown = undefined; return; }
    const localUrl = (url: string) => { try { return new URL(url).origin === origin; } catch { return false; } };
    const protect = (window: BrowserWindow) => { window.webContents.on('will-navigate', (event, url) => { if (!localUrl(url)) event.preventDefault(); }); };
    protect(mainWindow);
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (!localUrl(url) || new URL(url).pathname !== '/display') return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280, height: 720, autoHideMenuBar: true, backgroundColor: '#000000',
          ...(isMac ? { titleBarStyle: 'hiddenInset' } : isWin ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#000000', symbolColor: '#ffffff', height: 40 } } : {}),
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
        }
      };
    });

    mainWindow.webContents.on('did-create-window', window => { protect(window); window.webContents.setBackgroundThrottling(false); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); });
    ipcMain.handle('choose-library', async event => {
      if (event.sender !== mainWindow?.webContents || !localUrl(event.senderFrame?.url || '')) throw new Error('无效的窗口');
      const result = await dialog.showOpenDialog(mainWindow, { title: '选择曲库文件夹', properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled) return;
      const replacement = await openLibrary(result.filePaths[0]);
      // Switch in place: portable EXE launchers must not relaunch an extracted temporary executable.
      for (const window of BrowserWindow.getAllWindows()) if (window !== mainWindow) window.close();
      await closeServer(server);
      try { server = await listen(replacement.app, activePort); }
      catch (error) { await replacement.store.close(); server = await listen(service.app, activePort); throw error; }
      const previous = service; service = replacement;
      await previous.store.close();
      await writeFile(settingsPath, JSON.stringify({ folder: result.filePaths[0] }));
      await mainWindow.loadURL(origin);
    });
    await mainWindow.loadURL(origin);
  }).catch(error => { console.error('MAIN ERROR CAUGHT:', error); dialog.showErrorBox('无法启动本地唱片室', `${error.message}\n请根据上面的具体错误检查运行环境。`); app.quit(); });
  app.on('before-quit', event => {
    if (quitting || !shutdown) return;
    event.preventDefault(); quitting = true;
    void shutdown().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
