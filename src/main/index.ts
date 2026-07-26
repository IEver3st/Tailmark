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
import { ManagedContentService } from './management/managed-content-service';
import { OperationJournal } from './management/operation-journal';
import { TrayController } from './tray/tray-controller';

app.setName('Tailmark');
if (process.platform === 'win32') app.setAppUserModelId('com.tailmark.app');

let mainWindow: BrowserWindow | null = null;
let trayController: TrayController | null = null;
let keepRunningInTray = false;
let isQuitting = false;

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

function getTrayIcon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build', 'icon.ico');
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null;
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else app.on('second-instance', () => showWindow());

if (singleInstance) app.whenReady().then(async () => {
  const dataRoot = app.getPath('userData');
  const downloadsRoot = app.getPath('downloads');
  await migrateLegacyUserData(dataRoot);
  const repository = new StateRepository(dataRoot);
  const initialState = await repository.load();
  keepRunningInTray = initialState.settings.keepRunningInTray;
  trayController = new TrayController({
    iconPath: getTrayIcon(),
    defaultDownloadsRoot: downloadsRoot,
    openWindow: showWindow,
    quit: () => {
      isQuitting = true;
      trayController?.destroy();
      app.quit();
    },
    isWindowVisible: () => mainWindow?.isVisible() ?? false,
  });
  trayController.configure(initialState.settings);
  if (initialState.settings.autoDetectInstallation) {
    const installation = await detectGameInstallation(initialState.settings.gameRoot).catch(() => null);
    if (installation && installation.root !== initialState.settings.gameRoot) {
      await repository.update((state) => { state.settings.gameRoot = installation.root; });
    }
  }
  const backups = new BackupService(dataRoot, repository);
  const sounds = new SoundService(dataRoot, repository, backups);
  const journal = new OperationJournal(dataRoot);
  const managed = new ManagedContentService({
    dataRoot,
    documentsRoot: app.getPath('documents'),
    repository,
    backups,
    sounds,
    journal,
  });
  registerIpc({
    dataRoot,
    downloadsRoot,
    repository,
    backups,
    installer: new InstallService(dataRoot, repository, backups),
    sounds,
    managed,
    journal,
    getWindow: () => mainWindow,
    onSettingsChanged: (settings) => {
      keepRunningInTray = settings.keepRunningInTray;
      trayController?.configure(settings);
    },
    onDownloadAutomationStateChanged: (state) => trayController?.updateAutomation(state),
    onDownloadAutomationEvent: (event) => trayController?.notify(event),
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [process.env['ELECTRON_RENDERER_URL']
      ? "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"], } });
  });
  createWindow();
  app.on('activate', showWindow);
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => trayController?.destroy());
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (!isQuitting && keepRunningInTray) return;
  app.quit();
});
