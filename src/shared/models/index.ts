export type ModType = 'skin' | 'sound' | 'ambiguous' | 'unsupported';
export type QueueStatus =
  | 'analysing'
  | 'ready'
  | 'needs-review'
  | 'duplicate'
  | 'conflict'
  | 'installing'
  | 'installed'
  | 'skipped'
  | 'failed';
export type CollisionPolicy = 'skip' | 'replace' | 'merge' | 'copy';
export type ValidationLevel = 'info' | 'warning' | 'error';

export interface GameInstallation {
  root: string;
  source: 'saved' | 'steam' | 'gaijin' | 'manual';
  valid: boolean;
  confidence: number;
  evidence: string[];
  validatedAt: string;
}

export interface ImportSource {
  kind: 'files' | 'folder' | 'drop';
  paths: string[];
  recursive: boolean;
  importedAt: string;
}

export interface ArchiveEntry {
  path: string;
  normalizedPath: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
  ignored: boolean;
  executable: boolean;
  unsafeReason?: string;
}

export interface ValidationWarning {
  code: string;
  level: ValidationLevel;
  title: string;
  detail: string;
}

export interface DetectionReason {
  label: string;
  weight: number;
  kind: 'skin' | 'sound' | 'safety' | 'structure';
}

export interface FolderTransformation {
  kind: 'wrap-loose-files' | 'flatten-wrapper' | 'preserve-root' | 'multi-root' | 'manual-root';
  from: string;
  to: string;
  reason: string;
}

export interface DetectedMod {
  type: ModType;
  confidence: number;
  reasons: DetectionReason[];
  needsReview: boolean;
}

export interface PackageRoot {
  sourcePrefix: string;
  destinationName: string;
  fileCount: number;
  contentHash?: string;
}

export interface InstallConflict {
  relativePath: string;
  kind: 'destination-exists' | 'file-collision' | 'duplicate-content';
  existingPath?: string;
  packages?: string[];
  resolution?: CollisionPolicy;
}

export interface ArchiveAnalysis {
  id: string;
  archivePath: string;
  displayName: string;
  originalFilename: string;
  archiveHash: string;
  fileCount: number;
  uncompressedSize: number;
  compressedSize: number;
  entries: ArchiveEntry[];
  detected: DetectedMod;
  roots: PackageRoot[];
  transformations: FolderTransformation[];
  proposedDestination: string;
  warnings: ValidationWarning[];
  conflicts: InstallConflict[];
  duplicateOf?: string;
  failure?: OperationFailure;
  status: QueueStatus;
  manualType?: Exclude<ModType, 'ambiguous' | 'unsupported'>;
  manualRoot?: string;
}

export interface OperationFailure {
  stage: 'analysis' | 'installation';
  message: string;
  technicalDetails?: string;
}

export interface SkinPackage {
  id: string;
  name: string;
  path: string;
  libraryPath?: string;
  active?: boolean;
  sourceArchive?: string;
  installedAt: string;
  fileCount: number;
  totalSize: number;
  contentHash?: string;
  validationStatus: 'valid' | 'warning' | 'invalid';
}

export interface SkinCollection {
  id: string;
  name: string;
  skinIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedSight {
  id: string;
  name: string;
  libraryPath: string;
  payloadPath?: string;
  sourceArchive: string;
  scope: 'all-tanks' | 'vehicle';
  vehicleId?: string;
  active: boolean;
  fileCount: number;
  totalSize: number;
  contentHash: string;
  importedAt: string;
  validationStatus: 'valid' | 'warning' | 'invalid';
  destinationPath?: string;
  backupId?: string;
}

export interface ManagedHangar {
  id: string;
  name: string;
  libraryPath: string;
  sourceArchive: string;
  configFile: string;
  active: boolean;
  fileCount: number;
  totalSize: number;
  contentHash: string;
  importedAt: string;
  validationStatus: 'valid' | 'warning' | 'invalid';
  deployedPaths?: string[];
  backupIds?: string[];
  previousConfigValue?: string | null;
}

export interface SafeModeState {
  active: boolean;
  activatedAt: string | null;
  previousCollectionId: string | null;
  previousSightIds: string[];
  previousHangarId: string | null;
  previousSoundProfileId: string | null;
  unmanagedWarnings: string[];
}

export type ManagedOperationKind =
  | 'archive-install'
  | 'downloads-install'
  | 'collection-switch'
  | 'safe-mode-enter'
  | 'safe-mode-restore'
  | 'sight-activation'
  | 'hangar-activation';

export interface RecoveryRecord {
  id: string;
  kind: ManagedOperationKind;
  label: string;
  phase: 'prepared' | 'staging' | 'committing' | 'rollback';
  startedAt: string;
  updatedAt: string;
  destinations: Array<{ path: string; existed: boolean }>;
  canResume: boolean;
  resumeAction?: 'activate-collection' | 'enter-safe-mode' | 'restore-safe-mode' | 'activate-sight' | 'activate-hangar';
  resumeId?: string;
  rollbackId?: string;
  technicalDetails?: string;
}

export interface DownloadAutomationEvent {
  id: string;
  archivePath: string;
  filename: string;
  createdAt: string;
  result: 'installed' | 'duplicate-recycled' | 'review' | 'failed';
  detail: string;
  analysis?: ArchiveAnalysis;
}

export interface DownloadAutomationState {
  enabled: boolean;
  folder: string;
  status: 'off' | 'watching' | 'paused-safe-mode' | 'paused-recovery' | 'processing' | 'error';
  lastScanAt: string | null;
  lastEvent: DownloadAutomationEvent | null;
  error: string | null;
}

export interface SoundPackage {
  id: string;
  name: string;
  libraryPath: string;
  archiveSource: string;
  importedAt: string;
  fileCount: number;
  totalSize: number;
  active: boolean;
  validationStatus: 'valid' | 'warning' | 'invalid';
  conflicts: string[];
  variants: string[];
  notes?: string;
  contentHash: string;
}

export interface SoundProfile {
  id: string;
  name: string;
  packageIds: string[];
  priority: string[];
  conflicts: Array<{ path: string; winnerPackageId: string; packageIds: string[] }>;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export type SoundInstallOwnership = 'managed' | 'matched' | 'modified' | 'stale' | 'unmanaged';

export interface SoundConfigState {
  status: 'enabled' | 'disabled' | 'partial' | 'missing' | 'unreadable';
  enableMod: boolean | null;
  fmodSoundEnable: boolean | null;
}

export interface ExternalSoundState {
  present: boolean;
  enabled: boolean;
  managed: boolean;
  markerPresent: boolean;
  ownership: SoundInstallOwnership;
  fileCount: number;
  soundFileCount: number;
  totalSize: number;
  path: string;
  contentHash: string;
  packageIds: string[];
  profileId: string | null;
  config: SoundConfigState;
  warnings: string[];
}

export interface InstallPlan {
  id: string;
  archiveId: string;
  archivePath: string;
  type: 'skin' | 'sound';
  gameRoot: string;
  roots: PackageRoot[];
  collisionPolicy: CollisionPolicy;
  estimatedBytes: number;
  createdAt: string;
}

export interface InstallResult {
  archiveId: string;
  packageId?: string;
  success: boolean;
  status: 'installed' | 'imported' | 'skipped' | 'failed';
  destinations: string[];
  filesWritten: number;
  bytesWritten: number;
  backupIds: string[];
  message: string;
  technicalDetails?: string;
  sourceZipDeleted?: boolean;
  cleanupWarning?: string;
}

export interface BackupRecord {
  id: string;
  createdAt: string;
  sourcePath: string;
  backupPath: string;
  reason: string;
  packageId?: string;
  restorable: boolean;
  size: number;
}

export interface ActivityRecord {
  id: string;
  createdAt: string;
  action: 'install-skin' | 'import-sound' | 'activate-sound' | 'deactivate-sound' | 'remove' | 'restore' | 'settings'
    | 'collection-switch' | 'safe-mode' | 'install-sight' | 'activate-sight' | 'install-hangar' | 'activate-hangar' | 'recovery';
  packageName: string;
  destination: string;
  result: 'success' | 'warning' | 'failed';
  fileCount: number;
  backupId?: string;
  details: string;
}

import type { AppTheme } from '../themes';

export interface AppSettings {
  version: 1;
  theme: AppTheme;
  gameRoot: string | null;
  autoDetectInstallation: boolean;
  defaultDuplicateBehaviour: CollisionPolicy;
  ignoreDuplicateContent: boolean;
  deleteSourceZipAfterInstall: boolean;
  autoInstallDownloads: boolean;
  downloadsFolder: string | null;
  keepRunningInTray: boolean;
  retainBackupCount: number;
  confirmBeforeReplacement: boolean;
  advancedSoundMerging: boolean;
  activeSoundPackageId: string | null;
  activeSoundProfileId: string | null;
}

export interface AppSnapshot {
  settings: AppSettings;
  installation: GameInstallation | null;
  skins: SkinPackage[];
  sounds: SoundPackage[];
  profiles: SoundProfile[];
  collections: SkinCollection[];
  sights: ManagedSight[];
  hangars: ManagedHangar[];
  safeMode: SafeModeState;
  recovery: RecoveryRecord | null;
  downloadAutomation: DownloadAutomationState;
  backups: BackupRecord[];
  activity: ActivityRecord[];
  gameRunning: boolean;
  externalSound: ExternalSoundState | null;
}

export interface OperationProgress {
  operationId: string;
  archiveId?: string;
  currentArchive?: string;
  operation: string;
  filesCompleted: number;
  totalFiles?: number;
  bytesProcessed: number;
  totalBytes?: number;
  itemsCompleted: number;
  totalItems: number;
  successes: number;
  warnings: number;
  failures: number;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: string };
}

export interface AnalyzeRequest {
  paths: string[];
  gameRoot: string | null;
  operationId: string;
}

export interface InstallRequest {
  analyses: ArchiveAnalysis[];
  collisionPolicy: CollisionPolicy;
  operationId: string;
}

export interface TailmarkApi {
  app: {
    bootstrap(): Promise<ApiResult<AppSnapshot>>;
    snapshot(): Promise<ApiResult<AppSnapshot>>;
    openAppData(): Promise<ApiResult<null>>;
    clearTemporaryFiles(): Promise<ApiResult<number>>;
  };
  dialogs: {
    chooseArchives(): Promise<ApiResult<string[]>>;
    chooseImportFolder(): Promise<ApiResult<string[]>>;
    chooseGameRoot(): Promise<ApiResult<GameInstallation | null>>;
    chooseDownloadsFolder(): Promise<ApiResult<string | null>>;
    exportActivity(defaultName: string, content: string): Promise<ApiResult<string | null>>;
  };
  files: {
    pathsForDroppedFiles(files: File[]): string[];
    openPath(path: string): Promise<ApiResult<null>>;
  };
  archives: {
    analyze(request: AnalyzeRequest): Promise<ApiResult<ArchiveAnalysis[]>>;
    cancel(operationId: string): Promise<ApiResult<null>>;
  };
  install: {
    run(request: InstallRequest): Promise<ApiResult<InstallResult[]>>;
  };
  library: {
    refresh(): Promise<ApiResult<Pick<AppSnapshot, 'skins' | 'sounds' | 'profiles' | 'backups' | 'activity'>>>;
    removeSkin(id: string): Promise<ApiResult<null>>;
    removeSound(id: string): Promise<ApiResult<null>>;
    renameSkin(id: string, name: string): Promise<ApiResult<SkinPackage>>;
    activateSound(id: string): Promise<ApiResult<null>>;
    deactivateSound(): Promise<ApiResult<null>>;
    createProfile(name: string, packageIds: string[]): Promise<ApiResult<SoundProfile>>;
    adoptSound(name: string): Promise<ApiResult<SoundProfile>>;
    reconnectSound(): Promise<ApiResult<SoundProfile>>;
    activateProfile(id: string): Promise<ApiResult<null>>;
    renameProfile(id: string, name: string): Promise<ApiResult<SoundProfile>>;
    removeProfile(id: string): Promise<ApiResult<null>>;
    restoreBackup(id: string): Promise<ApiResult<null>>;
    createCollection(name: string): Promise<ApiResult<SkinCollection>>;
    setCollectionMembers(id: string, skinIds: string[]): Promise<ApiResult<SkinCollection>>;
    activateCollection(id: string): Promise<ApiResult<null>>;
    removeCollection(id: string): Promise<ApiResult<null>>;
    importSights(paths: string[]): Promise<ApiResult<ManagedSight[]>>;
    activateSight(id: string): Promise<ApiResult<null>>;
    deactivateSight(id: string): Promise<ApiResult<null>>;
    removeSight(id: string): Promise<ApiResult<null>>;
    importHangars(paths: string[]): Promise<ApiResult<ManagedHangar[]>>;
    activateHangar(id: string): Promise<ApiResult<null>>;
    deactivateHangar(): Promise<ApiResult<null>>;
    removeHangar(id: string): Promise<ApiResult<null>>;
  };
  safeMode: {
    enter(): Promise<ApiResult<SafeModeState>>;
    restore(): Promise<ApiResult<SafeModeState>>;
  };
  recovery: {
    resume(): Promise<ApiResult<null>>;
    rollback(): Promise<ApiResult<null>>;
  };
  game: {
    detect(): Promise<ApiResult<GameInstallation | null>>;
    validate(path: string): Promise<ApiResult<GameInstallation>>;
    running(): Promise<ApiResult<boolean>>;
  };
  settings: {
    update(patch: Partial<AppSettings>): Promise<ApiResult<AppSettings>>;
    reset(): Promise<ApiResult<AppSettings>>;
  };
  window: {
    control(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  };
  events: {
    onProgress(callback: (progress: OperationProgress) => void): () => void;
    onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
    onDownloadAutomation(callback: (event: DownloadAutomationEvent) => void): () => void;
  };
}
