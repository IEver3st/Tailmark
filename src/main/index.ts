import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { is } from '@electron-toolkit/utils';
import { BackupService } from './backups/backup-service';
import { registerIpc } from './ipc/register';
import { InstallService } from './installation/install-service';
import { SoundService } from './installation/sound-service';
import { StateRepository } from './persistence/state';
import { detectGameInstallation } from './detection/game-installation';

app.setName('Tailmark');

let mainWindow: BrowserWindow | null = null;

async function migrateLegacyUserData(dataRoot: string): Promise<void> {
  if (existsSync(join(dataRoot, 'state.json'))) return;
  const legacyRoot = join(dirname(dataRoot), 'ThunderModManager');
  if (!existsSync(join(legacyRoot, 'state.json'))) return;
  await mkdir(dataRoot, { recursive: true });
  await cp(legacyRoot, dataRoot, { recursive: true, force: false, errorOnExist: false });
}

function getWindowIcon(): string | undefined {
  const iconPath = join(app.getAppPath(), 'build', 'icon.png');
  return existsSync(iconPath) ? iconPath : undefined;
}

function createWindow(): void {
  const windowIcon = getWindowIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1f2529',
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  const dataRoot = app.getPath('userData');
  await migrateLegacyUserData(dataRoot);
  const repository = new StateRepository(dataRoot);
  const initialState = await repository.load();
  if (initialState.settings.autoDetectInstallation) {
    const installation = await detectGameInstallation(initialState.settings.gameRoot).catch(() => null);
    if (installation && installation.root !== initialState.settings.gameRoot) {
      await repository.update((state) => { state.settings.gameRoot = installation.root; });
    }
  }
  const backups = new BackupService(dataRoot, repository);
  registerIpc({ dataRoot, repository, backups, installer: new InstallService(dataRoot, repository, backups), sounds: new SoundService(dataRoot, repository, backups), getWindow: () => mainWindow });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [process.env['ELECTRON_RENDERER_URL']
      ? "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"], } });
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
