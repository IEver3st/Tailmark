import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PROCESS_NAMES = new Set(['aces.exe', 'launcher.exe', 'gaijin.net updater.exe', 'war thunder launcher.exe']);

export async function isWarThunderRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5_000 });
    return stdout.split(/\r?\n/).some((line) => {
      const name = line.match(/^"([^"]+)"/)?.[1]?.toLowerCase();
      return name ? PROCESS_NAMES.has(name) : false;
    });
  } catch {
    throw new Error('Tailmark could not check whether War Thunder is running because Windows process detection failed. Sound activation is blocked; user skin installation is still available.');
  }
}
