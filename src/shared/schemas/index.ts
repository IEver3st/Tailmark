import { z } from 'zod';
import { APP_THEMES } from '../themes';

const safePath = z.string().min(1).max(32_767);
const id = z.string().min(1).max(200).regex(/^[a-zA-Z0-9._:-]+$/);

export const analyzeRequestSchema = z.object({
  paths: z.array(safePath).min(1).max(5_000),
  gameRoot: safePath.nullable(),
  operationId: id,
});

export const collisionPolicySchema = z.enum(['skip', 'replace', 'merge', 'copy']);

const archiveEntrySchema = z.object({
  path: safePath,
  normalizedPath: safePath,
  isDirectory: z.boolean(),
  compressedSize: z.number().nonnegative().finite(),
  uncompressedSize: z.number().nonnegative().finite(),
  ignored: z.boolean(),
  executable: z.boolean(),
  unsafeReason: z.string().max(2_000).optional(),
}).strict();

const archiveAnalysisSchema = z.object({
  id,
  archivePath: safePath,
  displayName: z.string().min(1).max(260),
  originalFilename: z.string().min(1).max(260),
  archiveHash: z.string().max(128),
  fileCount: z.number().int().nonnegative().max(25_000),
  uncompressedSize: z.number().nonnegative().finite().max(20 * 1024 * 1024 * 1024),
  compressedSize: z.number().nonnegative().finite(),
  entries: z.array(archiveEntrySchema).max(25_000),
  detected: z.object({
    type: z.enum(['skin', 'sound', 'ambiguous', 'unsupported']),
    confidence: z.number().min(0).max(100),
    reasons: z.array(z.object({ label: z.string().max(500), weight: z.number().finite(), kind: z.enum(['skin', 'sound', 'safety', 'structure']) }).strict()).max(100),
    needsReview: z.boolean(),
  }).strict(),
  roots: z.array(z.object({ sourcePrefix: z.string().max(32_767), destinationName: z.string().min(1).max(260), fileCount: z.number().int().nonnegative(), contentHash: z.string().max(128).optional() }).strict()).max(1_000),
  transformations: z.array(z.object({ kind: z.enum(['wrap-loose-files', 'flatten-wrapper', 'preserve-root', 'multi-root', 'manual-root']), from: z.string().max(32_767), to: z.string().max(32_767), reason: z.string().max(2_000) }).strict()).max(1_000),
  proposedDestination: z.string().max(32_767),
  warnings: z.array(z.object({ code: z.string().max(100), level: z.enum(['info', 'warning', 'error']), title: z.string().max(500), detail: z.string().max(4_000) }).strict()).max(1_000),
  conflicts: z.array(z.object({ relativePath: z.string().max(32_767), kind: z.enum(['destination-exists', 'file-collision', 'duplicate-content']), existingPath: z.string().max(32_767).optional(), packages: z.array(z.string().max(260)).max(1_000).optional(), resolution: collisionPolicySchema.optional() }).strict()).max(10_000),
  duplicateOf: z.string().max(260).optional(),
  failure: z.object({ stage: z.enum(['analysis', 'installation']), message: z.string().min(1).max(4_000), technicalDetails: z.string().max(20_000).optional() }).strict().optional(),
  status: z.enum(['analysing', 'ready', 'needs-review', 'duplicate', 'conflict', 'installing', 'installed', 'skipped', 'failed']),
  manualType: z.enum(['skin', 'sound']).optional(),
  manualRoot: z.string().max(32_767).optional(),
}).strict();

export const installRequestSchema = z.object({
  analyses: z.array(archiveAnalysisSchema).min(1).max(5_000),
  collisionPolicy: collisionPolicySchema,
  operationId: id,
});

export const pathSchema = safePath;
export const idSchema = id;
export const windowActionSchema = z.enum(['minimize', 'maximize', 'close']);
export const profileSchema = z.object({ name: z.string().trim().min(1).max(120), packageIds: z.array(id).min(1).max(20) });
export const adoptSoundSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const renameSchema = z.object({ id, name: z.string().trim().min(1).max(120) });

export const settingsPatchSchema = z.object({
  theme: z.enum(APP_THEMES).optional(),
  gameRoot: safePath.nullable().optional(),
  autoDetectInstallation: z.boolean().optional(),
  defaultDuplicateBehaviour: collisionPolicySchema.optional(),
  ignoreDuplicateContent: z.boolean().optional(),
  deleteSourceZipAfterInstall: z.boolean().optional(),
  retainBackupCount: z.number().int().min(1).max(100).optional(),
  confirmBeforeReplacement: z.boolean().optional(),
  advancedSoundMerging: z.boolean().optional(),
  activeSoundPackageId: id.nullable().optional(),
  activeSoundProfileId: id.nullable().optional(),
}).strict();
