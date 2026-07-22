import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { ActivityRecord, AppSettings, BackupRecord, SkinPackage, SoundPackage, SoundProfile } from '@shared/models';
import { AtomicJsonStore } from './json-store';

interface PersistedState {
  version: 1;
  settings: AppSettings;
  skins: SkinPackage[];
  sounds: SoundPackage[];
  profiles: SoundProfile[];
  backups: BackupRecord[];
  activity: ActivityRecord[];
}

export class StateRepository {
  private readonly store: AtomicJsonStore<PersistedState>;
  private state: PersistedState | null = null;

  constructor(dataRoot: string) {
    this.store = new AtomicJsonStore(join(dataRoot, 'state.json'), {
      version: 1, settings: DEFAULT_SETTINGS, skins: [], sounds: [], profiles: [], backups: [], activity: [],
    });
  }

  async load(): Promise<PersistedState> {
    this.state ??= await this.store.read();
    const legacy = this.state.settings as AppSettings & { keepZipFiles?: boolean };
    const deleteSourceZipAfterInstall = legacy.deleteSourceZipAfterInstall
      ?? (legacy.keepZipFiles === false);
    const { keepZipFiles: _legacyKeepZipFiles, ...saved } = legacy;
    this.state.settings = { ...DEFAULT_SETTINGS, ...saved, deleteSourceZipAfterInstall, version: 1 };
    return this.state;
  }

  async update(mutator: (state: PersistedState) => void): Promise<PersistedState> {
    const state = await this.load();
    mutator(state);
    await this.store.write(state);
    return state;
  }

  async addActivity(record: Omit<ActivityRecord, 'id' | 'createdAt'>): Promise<void> {
    await this.update((state) => {
      state.activity.unshift({ ...record, id: randomUUID(), createdAt: new Date().toISOString() });
      state.activity = state.activity.slice(0, 2_000);
    });
  }
}
