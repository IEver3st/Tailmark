import { join } from 'node:path';
import type { InstallResult } from '@shared/models';

export async function completeSoundInstallResults(
  results: InstallResult[],
  gameRoot: string,
  activatePackage: (packageId: string) => Promise<void>,
): Promise<void> {
  const importedSounds = results.filter((result) => result.success && result.status === 'imported' && result.packageId);
  if (importedSounds.length === 1 && importedSounds[0]?.packageId) {
    const imported = importedSounds[0];
    const packageId = imported.packageId!;
    try {
      await activatePackage(packageId);
      const destination = join(gameRoot, 'sound', 'mod');
      imported.status = 'installed';
      imported.destinations.push(destination);
      imported.message = `Installed directly into ${destination}.`;
    } catch (error) {
      imported.cleanupWarning = `The package was saved in the Tailmark library, but could not be copied into sound\\mod. ${error instanceof Error ? error.message : 'Activation failed.'}`;
      imported.message = 'Imported into the sound library, but not yet installed into War Thunder.';
    }
    return;
  }
  if (importedSounds.length > 1) {
    for (const imported of importedSounds) {
      imported.cleanupWarning = 'Multiple sound archives were imported together. Choose one profile in Library to install it into sound\\mod, or explicitly create a combined profile.';
      imported.message = 'Imported into the sound library; profile selection is required before deployment.';
    }
  }
}
