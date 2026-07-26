import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { BackupRecord } from '@shared/models';
import { copyDirectory, directorySize, pathExists, replaceDirectory } from '@main/filesystem/file-operations';
import { StateRepository } from '@main/persistence/state';

export class BackupService {
  constructor(private readonly dataRoot: string, private readonly repository: StateRepository) {}

  async create(sourcePath: string, reason: string, packageId?: string): Promise<BackupRecord | null> {
    if (!await pathExists(sourcePath)) return null;
    const id = randomUUID();
    const backupPath = join(this.dataRoot, 'backups', id, basename(sourcePath));
    await mkdir(join(this.dataRoot, 'backups', id), { recursive: true });
    await copyDirectory(sourcePath, backupPath);
    const record: BackupRecord = {
      id, createdAt: new Date().toISOString(), sourcePath, backupPath, reason,
      ...(packageId ? { packageId } : {}), restorable: true, size: await directorySize(backupPath),
    };
    await this.repository.update((state) => { state.backups.unshift(record); });
    return record;
  }

  async restore(record: BackupRecord): Promise<void> {
    if (!await pathExists(record.backupPath)) throw new Error('Backup files are no longer available.');
    const parent = join(record.sourcePath, '..');
    const staging = join(parent, `.tailmark-restore-${record.id}`);
    const rollback = join(parent, `.tailmark-rollback-${record.id}`);
    await rm(staging, { recursive: true, force: true });
    await copyDirectory(record.backupPath, staging);
    await replaceDirectory(staging, record.sourcePath, rollback);
  }

  async enforceRetention(limit: number): Promise<void> {
    const state = await this.repository.load();
    const protectedIds = new Set<string>();
    for (const sight of state.sights) if (sight.active && sight.backupId) protectedIds.add(sight.backupId);
    for (const hangar of state.hangars) {
      if (hangar.active) for (const id of hangar.backupIds ?? []) protectedIds.add(id);
    }
    const ordinary = state.backups.filter((record) => !protectedIds.has(record.id));
    const excessIds = new Set(ordinary.slice(limit).map((record) => record.id));
    const excess = state.backups.filter((record) => excessIds.has(record.id));
    for (const record of excess) await rm(join(this.dataRoot, 'backups', record.id), { recursive: true, force: true });
    if (excess.length) await this.repository.update((draft) => {
      draft.backups = draft.backups.filter((record) => !excessIds.has(record.id));
    });
  }
}
