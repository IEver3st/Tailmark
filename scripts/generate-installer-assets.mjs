#!/usr/bin/env node
/**
 * Generates Windows NSIS installer branding assets from Tailmark source art.
 * Deterministic. Skips writes when outputs are newer than sources (unless --force).
 *
 * Usage:
 *   node scripts/generate-installer-assets.mjs
 *   node scripts/generate-installer-assets.mjs --force
 */

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const force = process.argv.includes('--force');

const PATHS = {
  banner: join(root, 'build', 'branding', 'tailmark-banner.png'),
  sidebarArt: join(root, 'build', 'branding', 'tailmark-sidebar.png'),
  appIconPng: join(root, 'build', 'icon.png'),
  appIconIco: join(root, 'build', 'icon.ico'),
  installerIcon: join(root, 'build', 'installerIcon.ico'),
  uninstallerIcon: join(root, 'build', 'uninstallerIcon.ico'),
  installerHeader: join(root, 'build', 'installerHeader.bmp'),
  installerSidebar: join(root, 'build', 'installerSidebar.bmp'),
  uninstallerSidebar: join(root, 'build', 'uninstallerSidebar.bmp'),
  installerNsh: join(root, 'build', 'installer.nsh'),
};

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const INSTALLER_NSH = `; Tailmark NSIS customisation for electron-builder (include macros only).
; Do not replace the full installer script.

!macro customHeader
  BrandingText "Tailmark"
  !define MUI_FINISHPAGE_TITLE "Tailmark is ready"
  !define MUI_FINISHPAGE_TEXT "Tailmark was installed successfully.$\\r$\\n$\\r$\\nLaunch the application to locate War Thunder and manage user skins, sound mods, and profiles."
!macroend

; Force current-user install and skip the all-users / current-user choice page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Install Tailmark"
  !define MUI_WELCOMEPAGE_TEXT "Tailmark manages War Thunder user skins, sound mods and profiles.$\\r$\\n$\\r$\\nClose War Thunder before installing or updating Tailmark.$\\r$\\n$\\r$\\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Uninstall Tailmark"
  !define MUI_WELCOMEPAGE_TEXT "This will remove the Tailmark application from this computer.$\\r$\\n$\\r$\\nImported packages, backups, and application data stored under Tailmark's user-data folder will remain unless you remove them separately.$\\r$\\n$\\r$\\nClick Uninstall to continue."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
`;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fail(message) {
  console.error(`generate-installer-assets: ${message}`);
  process.exit(1);
}

async function mtimeMs(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

async function needsWrite(output, sources) {
  if (force || !(await exists(output))) return true;
  const outTime = await mtimeMs(output);
  for (const source of sources) {
    if ((await mtimeMs(source)) > outTime) return true;
  }
  return false;
}

async function writeIfChanged(path, bufferOrString) {
  const next =
    typeof bufferOrString === 'string'
      ? Buffer.from(bufferOrString, 'utf8')
      : bufferOrString;
  if (await exists(path)) {
    const prev = await readFile(path);
    if (prev.equals(next)) {
      console.log(`unchanged ${relative(root, path)}`);
      return false;
    }
  }
  await writeFile(path, next);
  console.log(`wrote ${relative(root, path)}`);
  return true;
}

async function toBmp24(image) {
  // NSIS MUI expects classic uncompressed 24-bit BMP (BGR, bottom-up, no alpha).
  const { data, info } = await image
    .flatten({ background: { r: 10, g: 10, b: 10 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`Expected 3-channel RGB bitmap data, got ${info.channels} channels`);
  }

  const rowSize = Math.ceil((info.width * 3) / 4) * 4;
  const pixelBytes = rowSize * info.height;
  const fileSize = 54 + pixelBytes;
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(fileSize, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(info.width, 18);
  header.writeInt32LE(info.height, 22); // bottom-up
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(0, 30);
  header.writeUInt32LE(pixelBytes, 34);

  const pixels = Buffer.alloc(pixelBytes);
  for (let y = 0; y < info.height; y += 1) {
    const srcY = info.height - 1 - y;
    let srcOffset = srcY * info.width * 3;
    let destOffset = y * rowSize;
    for (let x = 0; x < info.width; x += 1) {
      const r = data[srcOffset];
      const g = data[srcOffset + 1];
      const b = data[srcOffset + 2];
      pixels[destOffset] = b;
      pixels[destOffset + 1] = g;
      pixels[destOffset + 2] = r;
      srcOffset += 3;
      destOffset += 3;
    }
  }
  return Buffer.concat([header, pixels]);
}

/**
 * Dedicated 150×57 header: full Tailmark wordmark on near-black with generous padding.
 * Renders the mark rather than cropping the wide banner (avoids clipped glyphs).
 */
async function generateHeader() {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#0a0a0a"/>
  <defs>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#c8c8c8"/>
    </linearGradient>
  </defs>
  <text
    x="75"
    y="35"
    text-anchor="middle"
    font-family="Segoe UI, Arial, Helvetica, sans-serif"
    font-size="20"
    font-weight="600"
    fill="url(#mark)"
    letter-spacing="0.4"
  >Tailmark</text>
</svg>`;

  const image = sharp(Buffer.from(svg)).png({ force: true }).resize(150, 57, {
    fit: 'fill',
    kernel: sharp.kernel.lanczos3,
  });
  return toBmp24(image);
}

/**
 * Vertical sidebar from dedicated jet/mountain art (build/branding/tailmark-sidebar.png).
 * Cover-crop to 164×314 — never stretch.
 */
async function generateSidebar(position = 'centre') {
  if (!(await exists(PATHS.sidebarArt))) {
    throw new Error(
      `Missing sidebar art at ${relative(root, PATHS.sidebarArt)}. Place the Tailmark sidebar PNG there and re-run.`,
    );
  }

  const image = sharp(PATHS.sidebarArt).resize(164, 314, {
    fit: 'cover',
    position,
    kernel: sharp.kernel.lanczos3,
  });
  return toBmp24(image);
}

async function generateIco(sourcePng) {
  const buffers = [];
  for (const size of ICO_SIZES) {
    const png = await sharp(sourcePng)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    buffers.push(png);
  }
  return pngToIco(buffers);
}

function readBmpSize(buffer) {
  if (buffer.toString('ascii', 0, 2) !== 'BM') {
    throw new Error('Not a BMP file');
  }
  return {
    width: buffer.readInt32LE(18),
    height: Math.abs(buffer.readInt32LE(22)),
  };
}

async function main() {
  if (!(await exists(PATHS.banner))) {
    await fail(
      `Missing source banner at ${relative(root, PATHS.banner)}. Place the Tailmark banner PNG there and re-run.`,
    );
  }

  if (!(await exists(PATHS.sidebarArt))) {
    await fail(
      `Missing sidebar art at ${relative(root, PATHS.sidebarArt)}. Place the Tailmark sidebar PNG there and re-run.`,
    );
  }

  let iconSource = PATHS.appIconPng;
  if (!(await exists(PATHS.appIconPng))) {
    console.warn(
      'generate-installer-assets: build/icon.png missing — falling back to a square crop from the banner (temporary).',
    );
    iconSource = null;
  }

  await mkdir(join(root, 'build'), { recursive: true });
  await mkdir(join(root, 'build', 'branding'), { recursive: true });

  const bannerMeta = await sharp(PATHS.banner).metadata();
  if (!bannerMeta.width || !bannerMeta.height) {
    await fail('Could not read banner dimensions.');
  }

  const stamp = createHash('sha1')
    .update(`header-svg-v2|sidebar-art-v1|${bannerMeta.width}x${bannerMeta.height}`)
    .digest('hex')
    .slice(0, 8);
  console.log(`asset profile ${stamp}`);

  // Header depends on script logic (SVG), not banner pixels — always rewrite on --force
  // or when missing / older than this script.
  const scriptPath = fileURLToPath(import.meta.url);
  const headerSources = [scriptPath];
  if (await needsWrite(PATHS.installerHeader, headerSources)) {
    await writeIfChanged(PATHS.installerHeader, await generateHeader());
  } else {
    console.log(`skip ${relative(root, PATHS.installerHeader)} (up to date)`);
  }

  const sidebarSources = [PATHS.sidebarArt, scriptPath];
  if (await needsWrite(PATHS.installerSidebar, sidebarSources)) {
    await writeIfChanged(PATHS.installerSidebar, await generateSidebar('centre'));
  } else {
    console.log(`skip ${relative(root, PATHS.installerSidebar)} (up to date)`);
  }

  if (await needsWrite(PATHS.uninstallerSidebar, sidebarSources)) {
    // Slightly calmer: bias upward toward halo / peak.
    await writeIfChanged(PATHS.uninstallerSidebar, await generateSidebar('north'));
  } else {
    console.log(`skip ${relative(root, PATHS.uninstallerSidebar)} (up to date)`);
  }

  let icoBuffer;
  if (iconSource) {
    const icoSources = [iconSource];
    if (await needsWrite(PATHS.appIconIco, icoSources)) {
      icoBuffer = await generateIco(iconSource);
      await writeIfChanged(PATHS.appIconIco, icoBuffer);
    } else {
      console.log(`skip ${relative(root, PATHS.appIconIco)} (up to date)`);
      icoBuffer = await readFile(PATHS.appIconIco);
    }
  } else {
    const side = Math.min(bannerMeta.width, bannerMeta.height);
    const left = Math.floor(bannerMeta.width * 0.28 - side / 2);
    const top = Math.floor((bannerMeta.height - side) / 2);
    const fallbackPng = await sharp(PATHS.banner)
      .extract({
        left: Math.max(0, left),
        top: Math.max(0, top),
        width: side,
        height: side,
      })
      .resize(512, 512)
      .png()
      .toBuffer();
    icoBuffer = await generateIco(fallbackPng);
    await writeIfChanged(PATHS.appIconIco, icoBuffer);
  }

  if (
    force ||
    !(await exists(PATHS.installerIcon)) ||
    (await mtimeMs(PATHS.appIconIco)) > (await mtimeMs(PATHS.installerIcon))
  ) {
    if (!icoBuffer) icoBuffer = await readFile(PATHS.appIconIco);
    await writeIfChanged(PATHS.installerIcon, icoBuffer);
  } else {
    console.log(`skip ${relative(root, PATHS.installerIcon)} (up to date)`);
  }

  if (
    force ||
    !(await exists(PATHS.uninstallerIcon)) ||
    (await mtimeMs(PATHS.appIconIco)) > (await mtimeMs(PATHS.uninstallerIcon))
  ) {
    if (!icoBuffer) icoBuffer = await readFile(PATHS.appIconIco);
    await writeIfChanged(PATHS.uninstallerIcon, icoBuffer);
  } else {
    console.log(`skip ${relative(root, PATHS.uninstallerIcon)} (up to date)`);
  }

  await writeIfChanged(PATHS.installerNsh, INSTALLER_NSH);

  for (const [label, path, w, h] of [
    ['installerHeader', PATHS.installerHeader, 150, 57],
    ['installerSidebar', PATHS.installerSidebar, 164, 314],
    ['uninstallerSidebar', PATHS.uninstallerSidebar, 164, 314],
  ]) {
    const { width, height } = readBmpSize(await readFile(path));
    if (width !== w || height !== h) {
      await fail(`${label} is ${width}×${height}, expected ${w}×${h}`);
    }
    console.log(`ok ${label} ${width}×${height}`);
  }

  for (const path of [PATHS.appIconIco, PATHS.installerIcon, PATHS.uninstallerIcon]) {
    if (!(await exists(path))) await fail(`Missing ICO output: ${relative(root, path)}`);
  }

  console.log('Installer assets ready.');
}

main().catch(async (error) => {
  await fail(error instanceof Error ? error.message : String(error));
});
