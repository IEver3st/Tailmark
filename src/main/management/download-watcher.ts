import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { DownloadAutomationEvent, DownloadAutomationState } from '@shared/models';
import { mapWithConcurrency } from '@main/concurrency';

interface DownloadWatcherOptions {
  defaultFolder: string;
  maxConcurrent?: number;
  processArchive(path: string): Promise<DownloadAutomationEvent>;
  onEvent(event: DownloadAutomationEvent): void;
  onStateChange?(state: DownloadAutomationState): void;
  canProcess(): Promise<'ready' | 'safe-mode' | 'recovery'>;
}

export class DownloadAutomationPausedError extends Error {
  constructor(readonly reason: 'safe-mode' | 'recovery') {
    super(reason === 'safe-mode'
      ? 'Automatic Downloads installation paused while Safe Mode is active.'
      : 'Automatic Downloads installation paused until the current operation is resolved.');
    this.name = 'DownloadAutomationPausedError';
  }
}

export class DownloadWatcher {
  private watcher: FSWatcher | null = null;
  private folder: string;
  private enabled = false;
  private status: DownloadAutomationState['status'] = 'off';
  private lastScanAt: string | null = null;
  private lastEvent: DownloadAutomationEvent | null = null;
  private error: string | null = null;
  private readonly seen = new Map<string, string>();
  private readonly pending = new Set<string>();
  private readonly scheduled = new Set<string>();
  private readonly retryAfterCompletion = new Map<string, string>();
  private queue: Array<{ path: string; key: string }> = [];
  private activeTasks = 0;
  private processingTasks = 0;
  private pauseReason: 'safe-mode' | 'recovery' | null = null;
  private watchFailed = false;

  constructor(private readonly options: DownloadWatcherOptions) {
    this.folder = options.defaultFolder;
  }

  snapshot(): DownloadAutomationState {
    return {
      enabled: this.enabled,
      folder: this.folder,
      status: this.status,
      lastScanAt: this.lastScanAt,
      lastEvent: this.lastEvent,
      error: this.error,
    };
  }

  async configure(enabled: boolean, folder: string | null): Promise<void> {
    const nextFolder = folder ?? this.options.defaultFolder;
    if (this.enabled === enabled && this.folder.toLowerCase() === nextFolder.toLowerCase() && this.watcher) return;
    this.stop();
    this.enabled = enabled;
    this.folder = nextFolder;
    this.error = null;
    this.watchFailed = false;
    this.pauseReason = null;
    this.seen.clear();
    this.pending.clear();
    if (!enabled) {
      this.updateStatus();
      return;
    }
    try {
      const entries = (await readdir(this.folder, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.zip');
      await mapWithConcurrency(entries, this.concurrency, async (entry) => {
        const path = join(this.folder, entry.name);
        try {
          const details = await stat(path);
          this.seen.set(path.toLowerCase(), `${details.size}:${details.mtimeMs}`);
        } catch {
          // A file can disappear while the initial Downloads baseline is being indexed.
        }
      });
      this.lastScanAt = new Date().toISOString();
      this.watcher = watch(this.folder, { persistent: false }, (_event, filename) => {
        if (!filename || extname(filename).toLowerCase() !== '.zip') return;
        this.schedule(join(this.folder, filename));
      });
      this.watcher.on('error', (error) => {
        this.watchFailed = true;
        this.error = error.message;
        this.updateStatus();
      });
      this.updateStatus();
    } catch (error) {
      this.watchFailed = true;
      this.error = error instanceof Error ? error.message : 'The Downloads folder could not be watched.';
      this.updateStatus();
    }
  }

  async resumePending(): Promise<void> {
    const paths = [...this.pending];
    this.pending.clear();
    this.pauseReason = null;
    this.updateStatus();
    for (const path of paths) {
      const key = path.toLowerCase();
      if (this.scheduled.has(key)) this.retryAfterCompletion.set(key, path);
      else this.schedule(path);
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.queue = [];
    this.scheduled.clear();
    this.retryAfterCompletion.clear();
  }

  private schedule(path: string): void {
    if (!this.enabled) return;
    const key = path.toLowerCase();
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    this.queue.push({ path, key });
    this.drain();
  }

  private drain(): void {
    while (this.activeTasks < this.concurrency) {
      const task = this.queue.shift();
      if (!task) return;
      this.activeTasks += 1;
      void this.processWhenStable(task.path)
        .catch(() => undefined)
        .finally(() => {
          this.activeTasks -= 1;
          this.scheduled.delete(task.key);
          const retry = this.retryAfterCompletion.get(task.key);
          if (retry) {
            this.retryAfterCompletion.delete(task.key);
            this.schedule(retry);
          }
          this.drain();
        });
    }
  }

  private async processWhenStable(path: string): Promise<void> {
    let previous: string;
    try {
      const details = await stat(path);
      if (!details.isFile() || details.size === 0) return;
      previous = `${details.size}:${details.mtimeMs}`;
    } catch {
      return;
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 750));
      let signature: string;
      try {
        const details = await stat(path);
        if (!details.isFile() || details.size === 0) return;
        signature = `${details.size}:${details.mtimeMs}`;
      } catch {
        return;
      }
      if (signature === previous) {
        const key = path.toLowerCase();
        if (this.seen.get(key) === signature) return;
        const availability = await this.options.canProcess();
        if (availability !== 'ready') {
          this.pending.add(path);
          this.pauseReason = availability;
          this.updateStatus();
          return;
        }
        this.processingTasks += 1;
        this.updateStatus();
        this.lastScanAt = new Date().toISOString();
        try {
          const event = await this.options.processArchive(path);
          this.seen.set(key, signature);
          this.lastEvent = event;
          this.error = null;
          this.options.onEvent(event);
        } catch (error) {
          if (error instanceof DownloadAutomationPausedError) {
            this.pending.add(path);
            this.pauseReason = error.reason;
            return;
          }
          const event: DownloadAutomationEvent = {
            id: `download:${Date.now()}`,
            archivePath: path,
            filename: basename(path),
            createdAt: new Date().toISOString(),
            result: 'failed',
            detail: error instanceof Error ? error.message : 'Automatic installation failed.',
          };
          this.lastEvent = event;
          this.error = event.detail;
          this.options.onEvent(event);
        } finally {
          this.processingTasks -= 1;
          this.updateStatus();
        }
        return;
      }
      previous = signature;
    }
  }

  private get concurrency(): number {
    return Math.max(1, Math.floor(this.options.maxConcurrent ?? 4));
  }

  private updateStatus(): void {
    if (!this.enabled) this.status = 'off';
    else if (this.watchFailed) this.status = 'error';
    else if (this.pauseReason === 'safe-mode') this.status = 'paused-safe-mode';
    else if (this.pauseReason === 'recovery') this.status = 'paused-recovery';
    else if (this.processingTasks > 0) this.status = 'processing';
    else this.status = 'watching';
    this.options.onStateChange?.(this.snapshot());
  }
}
