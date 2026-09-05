#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ResEdit from 'resedit';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electronVite = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} exited after signal ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function prepareWindowsElectron() {
  const electronModule = await import('electron');
  const sourceExecutable = electronModule.default;
  if (typeof sourceExecutable !== 'string') {
    throw new Error('Could not resolve the Electron development executable.');
  }

  const iconPath = join(root, 'build', 'icon.ico');
  if (!(await exists(iconPath))) throw new Error(`Missing development icon: ${iconPath}`);

  const iconData = await readFile(iconPath);
  const iconHash = createHash('sha256').update(iconData).digest('hex').slice(0, 12);
  const electronVersion = JSON.parse(
    await readFile(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
  ).version;
  const brandedExecutable = join(
    dirname(sourceExecutable),
    `Tailmark-Dev-${electronVersion}-${iconHash}-resedit.exe`,
  );

  if (!(await exists(brandedExecutable))) {
    const temporaryExecutable = `${brandedExecutable}.${process.pid}.tmp`;
    try {
      const executable = ResEdit.NtExecutable.from(await readFile(sourceExecutable), {
        ignoreCert: true,
      });
      const resources = ResEdit.NtExecutableResource.from(executable);
      const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
      if (iconGroups.length === 0) {
        throw new Error('Electron executable does not contain an icon resource group.');
      }
      const icons = ResEdit.Data.IconFile.from(iconData).icons.map((icon) => icon.data);
      for (const group of iconGroups) {
        ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
          resources.entries,
          group.id,
          group.lang,
          icons,
        );
      }
      resources.outputResource(executable);
      await writeFile(temporaryExecutable, Buffer.from(executable.generate()));
      try {
        await rename(temporaryExecutable, brandedExecutable);
      } catch (error) {
        if (!(await exists(brandedExecutable))) throw error;
      }
    } finally {
      await rm(temporaryExecutable, { force: true });
    }
    console.log(`Prepared branded Electron host: ${brandedExecutable}`);
  }

  return brandedExecutable;
}

async function main() {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;

  if (process.platform === 'win32') {
    environment.ELECTRON_EXEC_PATH = await prepareWindowsElectron();
  }

  await run(process.execPath, [electronVite, 'dev', ...process.argv.slice(2)], {
    cwd: root,
    env: environment,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
