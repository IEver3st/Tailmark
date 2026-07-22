# Tailmark

Tailmark is a local Windows desktop application for safely analysing, installing, and managing War Thunder user skins and sound modifications. It is designed for large batches of inconsistent ZIP archives and makes every game-directory write reviewed, staged, backed up, and recoverable.

## Requirements

- Windows 10 or Windows 11
- Node.js 22 or newer
- npm 10 or newer

No War Thunder installation is required for development or automated tests.

## Commands

```powershell
npm install
npm run dev
```

Build the production application:

```powershell
npm run build
```

Create the Windows x64 NSIS installer:

```powershell
npm run dist:win
```

(`npm run package:win` is an alias for the same command.)

Generate the representative ZIP corpus and run tests:

```powershell
npm run fixtures
npm test
npm run typecheck
```

Generated fixtures are written to `fixtures/generated/` and are intentionally excluded from source control.

## Application architecture

```text
src/
├── main/
│   ├── ipc/              validated Electron handlers
│   ├── filesystem/       path safety and transactional file operations
│   ├── archives/         streamed ZIP inspection, extraction, and normalisation
│   ├── detection/        game and mod-type detection
│   ├── installation/     skin installs and sound activation
│   ├── backups/          restorable backup records
│   ├── config-blk/       brace-aware config editor
│   ├── processes/        Windows game-process checks
│   └── persistence/      versioned atomic JSON storage
├── preload/              typed, narrow context bridge
├── renderer/             React workbench and Zustand state
└── shared/               models, constants, and Zod IPC schemas
```

The renderer has no Node.js or filesystem access. `contextIsolation`, the Chromium sandbox, and web security are enabled; `nodeIntegration` is disabled. The preload exposes only typed operations. Every renderer-controlled IPC argument is parsed again with bounded Zod schemas in the main process.

ZIPs are opened with `yauzl` in lazy-entry mode. Extraction uses per-entry streams and never executes archive content. The main process rejects traversal, absolute paths, alternate data streams, reserved Windows names, symbolic links, excessive depth, implausible compression ratios, excessive entry counts, and oversized expanded archives before committing content.

## War Thunder path detection

Detection runs at first launch when enabled and considers candidates in this order:

1. The previously saved path
2. Steam's default installation plus every library in `steamapps/libraryfolders.vdf`
3. Common standalone Gaijin locations under Program Files and Local AppData
4. A user-selected directory from **Select War Thunder Installation**

A directory is scored from concrete evidence. `config.blk` and `aces.exe`/`win64/aces.exe` are strong evidence; existing `UserSkins` and `sound` folders add confidence but are not required. A candidate needs the strong evidence combination before it is accepted. The selected path is revalidated before every install or sound activation.

## Folder normalisation

Normalisation is deterministic and runs before extraction:

- Loose skin files are wrapped in a Windows-safe folder derived from the ZIP basename.
- One valid existing skin parent is preserved without adding duplicate nesting.
- Single-child wrapper chains are flattened until direct, credible mod files are reached.
- `__MACOSX`, AppleDouble files, `.DS_Store`, `Thumbs.db`, and `desktop.ini` are ignored during structural reasoning.
- Independent credible sibling skin folders become separate destinations in a multi-skin plan.
- Sound packages are rooted at their actual `sound/mod` content; wrapper folders such as `<package>/sound/mod/` and `mod/` are removed so only the payload is deployed.
- README-style documentation is retained but does not affect classification.
- Mixed signals, unsafe entries, executable content, encryption, corruption, or speculative layouts remain in **Needs Review**.

Folder names preserve useful spaces and punctuation; only Windows-invalid characters, reserved device names, and invalid trailing characters are changed.

## Transaction model

Skin installation follows:

```text
inspect → classify → normalise → validate → detect conflicts
→ extract to same-volume staging → verify → back up
→ atomic directory swap → record activity
```

Collision policies are Skip, Replace, Merge, and Install as Copy. Replace and Merge always create a backup. A failed directory swap restores the previous destination. Readable copies use names such as `Skin Name (2)`.

User skin installation remains available while War Thunder is running because skins are written only beneath `UserSkins`. Sound activation and deactivation still require the game and launcher to be closed because those operations change active game files and `config.blk`.

Duplicate skin detection fingerprints canonical relative paths, sizes, and ZIP content checksums directly from the central directory, so analysis does not decompress large textures. It recognizes an installed skin even when the ZIP was recompressed or renamed. Tailmark-installed fingerprints are reused instead of re-reading the entire library; legacy or externally installed skins are warmed and persisted in the background, with foreground analysis waiting no more than 25 ms for that optional duplicate check. Duplicate items are skipped automatically when the setting is enabled and require explicit confirmation when it is disabled.

Installed-skin discovery is shallow on the foreground path. New external folders appear immediately, while a single background index pass calculates their file count, total size, and content fingerprint without launching an unbounded set of competing disk reads. When **Ignore duplicate content** is enabled, fully duplicate archives are marked Skipped and duplicate roots inside a mixed archive are removed from the install plan before extraction.

When **Move source ZIP to Recycle Bin** is enabled, Tailmark moves a skin archive to the Windows Recycle Bin only after at least one skin folder installs successfully. Failed and skipped archives remain in place, and a cleanup error is reported separately without changing the successful install result.

Sound archives are stored under the Electron user-data directory in `library/sounds/<package-id>/`, and every package has a named single-package profile. Installing one sound archive immediately activates that profile and copies its payload directly into `<War Thunder>/sound/mod/`; it never adds another `sound`, `mod`, or package wrapper. Importing several sound archives together leaves them inactive so the user can choose one profile or intentionally create a combined profile instead of having the last archive silently replace the others. Activation checks that War Thunder is not running, stages the profile, backs up `sound/mod`, safely updates `config.blk`, writes a management marker, swaps the staged directory, and records the operation.

Existing `sound/mod` installs are inventoried from all payload files, not only a fixed extension list. Tailmark fingerprints the deployed tree and compares it with saved packages and deterministic merged-profile outputs. The Library distinguishes verified management, an exact profile match that can be reconnected without replacing files, changed managed content, stale markers, and unknown installs that can be adopted. Deactivation deletes the folder only when both its marker and current fingerprint prove Tailmark ownership; otherwise it disables the config flag and preserves every payload file.

`config.blk` editing uses a brace-aware tokenizer that skips strings and comments. It preserves line endings and indentation where possible, removes duplicate properties, enables both `enable_mod` and `fmod_sound_enable`, writes `enable_mod:b=no` when disabling, validates the result, and creates a timestamped adjacent backup before a recoverable same-directory swap.

## Data storage

Electron's Windows user-data directory stores:

- `state.json` — versioned settings, library metadata, profiles, backups, and history
- `library/sounds/` — inactive managed sound packages
- `backups/` — restorable filesystem snapshots
- `temp/` — removable operation scratch space

JSON writes use a temporary file followed by a rename. The app does not require a database or network service.

## Windows installer

Tailmark ships an assisted NSIS installer built with electron-builder. Branding is monochrome jet-and-mountain art.

### Source art

| Role | Path |
| --- | --- |
| Installer banner (wordmark + jet scene) | `build/branding/tailmark-banner.png` |
| Installer sidebar art (jet + mountain) | `build/branding/tailmark-sidebar.png` |
| Application icon (square, preferred) | `build/icon.png` |

Replace those sources when branding changes, then regenerate derived assets.

### Regenerate installer assets

```powershell
npm run assets:installer
```

Force a full rewrite:

```powershell
node scripts/generate-installer-assets.mjs --force
```

Generated outputs (commit these so packaging works without Sharp on every machine):

- `build/icon.ico`
- `build/installerIcon.ico`
- `build/uninstallerIcon.ico`
- `build/installerHeader.bmp` (150×57)
- `build/installerSidebar.bmp` (164×314)
- `build/uninstallerSidebar.bmp` (164×314)
- `build/installer.nsh`

### Build the installer

```powershell
npm run dist:win
```

This regenerates installer assets, typechecks, builds with electron-vite, then runs `electron-builder --win nsis`.

Output directory: `release/`

Installer filename pattern: `Tailmark-Setup-<version>.exe` (for example `release/Tailmark-Setup-1.0.0.exe`).

### Behaviour

- Assisted installer (not one-click): directory selection, desktop and Start Menu shortcut options
- Current-user installation only (no all-users / install-mode page; `allowElevation: false`)
- Upgrades reuse the stable `appId` (`com.tailmark.app`) so Windows treats installs as the same product
- Uninstall removes the application files; Electron user-data (settings, imported sound packages, backups, activity) is left in place
- The installer does not modify War Thunder files

### Code signing

Public distribution should use an Authenticode certificate. This repository does not embed signing credentials. To sign locally, configure electron-builder Windows signing via environment variables or `win` certificate settings (for example `CSC_LINK` / `CSC_KEY_PASSWORD`, or `win.certificateFile` / `win.certificatePassword`). Unsigned installers may show SmartScreen warnings; that is expected until a valid certificate is configured.

### Windows-only notes

- NSIS packaging must run on Windows (or a Windows CI runner) with electron-builder’s NSIS toolchain
- Asset generation itself is cross-platform (Node + Sharp) and only needs the source PNG files

## Testing

Vitest covers path validation, classification, all major normalisation rules, corrupt and malicious ZIPs, content-hash duplicates, config editing, collision naming and merge behaviour, and rollback after a simulated failed commit. Integration tests use temporary directories and generated ZIPs; they never touch a real game installation.

See [IMPLEMENTATION_AUDIT.md](./IMPLEMENTATION_AUDIT.md) for the final requirement-by-requirement status and remaining limitations.
