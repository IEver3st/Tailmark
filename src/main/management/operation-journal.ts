import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManagedOperationKind, RecoveryRecord } from '@shared/models';
import { pathExists } from '@main/filesystem/file-operations';
import { AtomicJsonStore } from '@main/persistence/json-store';

interface BeginOptions {
  kind: ManagedOperationKind;
  label: string;
  destinations: string[];
  resumeAction?: RecoveryRecord['resumeAction'];
  resumeId?: string;
  rollbackId?: string;
}

export class OperationJournal {
  private readonly path: string;
  private readonly store: AtomicJsonStore<RecoveryRecord | null>;

  constructor(dataRoot: string) {
    this.path = join(dataRoot, 'operations', 'current.json');
    this.store = new AtomicJsonStore(this.path, null);
  }

  load(): Promise<RecoveryRecord | null> {
    return this.store.read();
  }

  async begin(options: BeginOptions): Promise<RecoveryRecord> {
    const pending = await this.load();
    if (pending) throw new Error(`Resolve the interrupted ${pending.label} operation before making more changes.`);
    const now = new Date().toISOString();
    const destinations = await Promise.all(options.destinations.map(async (path) => ({
      path,
      existed: await pathExists(path),
    })));
    const record: RecoveryRecord = {
      id: randomUUID(),
      kind: options.kind,
      label: options.label,
      phase: 'prepared',
      startedAt: now,
      updatedAt: now,
      destinations,
      canResume: Boolean(options.resumeAction),
      ...(options.resumeAction ? { resumeAction: options.resumeAction } : {}),
      ...(options.resumeId ? { resumeId: options.resumeId } : {}),
      ...(options.rollbackId ? { rollbackId: options.rollbackId } : {}),
    };
    await this.store.write(record);
    return record;
  }

  async phase(phase: RecoveryRecord['phase']): Promise<void> {
    const current = await this.load();
    if (!current) return;
    await this.store.write({ ...current, phase, updatedAt: new Date().toISOString() });
  }

  async fail(error: unknown): Promise<void> {
    const current = await this.load();
    if (!current) return;
    const technicalDetails = error instanceof Error ? error.stack ?? error.message : String(error);
    await this.store.write({
      ...current,
      updatedAt: new Date().toISOString(),
      technicalDetails: technicalDetails.slice(0, 20_000),
    });
  }

  async complete(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
