import { basename } from 'node:path';
import { Menu, Notification, Tray, nativeImage } from 'electron';
import type {
  AppSettings, DownloadAutomationEvent, DownloadAutomationState,
} from '@shared/models';

type BackgroundSettings = Pick<AppSettings, 'autoInstallDownloads' | 'downloadsFolder' | 'keepRunningInTray'>;

interface TrayControllerOptions {
  iconPath: string;
  defaultDownloadsRoot: string;
  openWindow(): void;
  quit(): void;
  isWindowVisible(): boolean;
}

const STATUS_LABELS: Record<DownloadAutomationState['status'], string> = {
  off: 'Automatic installs are off',
  watching: 'Watching for downloaded skins',
  'paused-safe-mode': 'Paused while Safe Mode is active',
  'paused-recovery': 'Paused until recovery is resolved',
  processing: 'Installing a downloaded skin',
  error: 'Download watcher needs attention',
};

function notificationCopy(event: DownloadAutomationEvent): { title: string; body: string } {
  if (event.result === 'installed') return { title: 'Downloaded skin installed', body: event.detail };
  if (event.result === 'duplicate-recycled') return { title: 'Duplicate skin download recycled', body: event.detail };
  if (event.result === 'review') return { title: 'Downloaded archive needs review', body: event.detail };
  return { title: 'Automatic skin installation failed', body: event.detail };
}

export class TrayController {
  private tray: Tray | null = null;
  private settings: BackgroundSettings = {
    autoInstallDownloads: false,
    downloadsFolder: null,
    keepRunningInTray: false,
  };
  private automation: DownloadAutomationState | null = null;

  constructor(private readonly options: TrayControllerOptions) {}

  configure(settings: AppSettings): void {
    this.settings = {
      autoInstallDownloads: settings.autoInstallDownloads,
      downloadsFolder: settings.downloadsFolder,
      keepRunningInTray: settings.keepRunningInTray,
    };
    if (!settings.keepRunningInTray) {
      this.destroy();
      return;
    }
    this.ensureTray();
    this.render();
  }

  updateAutomation(state: DownloadAutomationState): void {
    this.automation = state;
    if (this.tray) this.render();
  }

  notify(event: DownloadAutomationEvent): void {
    if (!this.tray || this.options.isWindowVisible() || !Notification.isSupported()) return;
    const copy = notificationCopy(event);
    const notification = new Notification({
      title: copy.title,
      body: copy.body,
      icon: this.options.iconPath,
    });
    notification.on('click', this.options.openWindow);
    notification.show();
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private ensureTray(): void {
    if (this.tray) return;
    const icon = nativeImage.createFromPath(this.options.iconPath);
    this.tray = new Tray(icon);
    this.tray.on('click', this.options.openWindow);
  }

  private render(): void {
    if (!this.tray) return;
    const folder = this.automation?.folder
      ?? this.settings.downloadsFolder
      ?? this.options.defaultDownloadsRoot;
    const status = this.automation
      ? STATUS_LABELS[this.automation.status]
      : this.settings.autoInstallDownloads
        ? 'Starting the download watcher'
        : STATUS_LABELS.off;
    this.tray.setToolTip(`Tailmark - ${status}`);
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Tailmark', click: this.options.openWindow },
      { type: 'separator' },
      { label: status, enabled: false },
      { label: `Folder: ${basename(folder) || folder}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit Tailmark', click: this.options.quit },
    ]));
  }
}
