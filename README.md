<div align="center">

# Tailmark

### A safer installer and manager for War Thunder user skins, sound mods, custom sights, and hangars

Inspect archives before installation, resolve conflicts deliberately and recover from mistakes through automatic backups.

[![Release](https://img.shields.io/badge/release-v1.1.0-blue)](https://github.com/IEver3st/ThunderMod/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4?logo=windows)](https://github.com/IEver3st/ThunderMod/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron)](https://www.electronjs.org/)
[![Licence](https://img.shields.io/badge/licence-MIT-green)](./LICENSE)

[Download](https://github.com/IEver3st/ThunderMod/releases/latest) · [Report an issue](https://github.com/IEver3st/ThunderMod/issues/new)

</div>

<!--
Add a screenshot of the Installer queue here.
Recommended path: docs/media/tailmark-installer.png
-->

## What's new in 1.1.0

See [CHANGELOG.md](./CHANGELOG.md) for the full list.

Highlights:

- **Downloads automation** - watch a folder for completed skin ZIPs and install high-confidence, skin-only archives automatically.
- **System tray mode** - keep Tailmark running in the Windows notification area so background automation stays alive.
- **Managed collections** - group installed skins and activate one collection at a time.
- **Custom sights and hangars** - import, store, and activate per-vehicle or `all_tanks` sights and hangar packages.
- **Safe Mode and recovery journal** - temporarily restore managed content and resume or roll back interrupted operations.
- **Library totals** - see total installed size for skins, sounds, and backups, plus size and file count per package.
- **Refined branding** - transparent branding assets and separate header branding from the application icon.

## Overview

Tailmark is a Windows desktop manager for War Thunder user skins, sound modifications, custom sights and hangars.

Rather than extracting an unknown ZIP directly into the game directory, Tailmark first analyses the archive, classifies its contents, predicts the destination and flags conflicts. Installation operations are backed up and can be rolled back if something fails.

The result is a mod workflow designed around inspection and recovery, not blind file replacement.

## Why Tailmark

Community mod archives are rarely packaged consistently. A download may contain:

- An extra wrapper folder
- Loose skin files
- A complete `UserSkins` structure
- macOS metadata
- Several unrelated packages
- Existing folder names
- A sound mod that requires configuration changes
- Sights or hangars that need specific paths

Tailmark normalises these layouts, explains what it found and lets the user decide what should happen before any game files are changed.

## Features

### Archive inspection

- Drag and drop one or more ZIP files
- Import an entire folder of archives
- Inspect archive contents before installation
- Classify packages as user skins, sound mods, sights, hangars or unsupported
- Identify unsupported or suspicious layouts
- Display the planned destination
- Flag duplicates, conflicts and malformed packages
- Ignore common archive debris such as `__MACOSX`
- Never execute files found inside an archive

### User skin management

- Install skins into War Thunder's `UserSkins` directory
- Handle loose files and nested wrapper folders
- Install multiple packages in one queue
- Detect identical content even when archive names differ
- Choose whether duplicate content is skipped automatically or flagged for review
- Choose how existing folders are handled
- Keep the game running while installing user skins
- Optionally move successfully imported source archives to the Recycle Bin

Conflict policies include:

| Policy | Behaviour |
|---|---|
| Skip | Leave the existing folder untouched |
| Replace | Back up the existing folder, then replace it |
| Merge | Back up the destination, then merge package contents |
| Install as copy | Create a separate renamed folder |

### Sound mod profiles

- Import sound packages into Tailmark's managed library
- Activate a single package immediately
- Combine multiple packages into a custom profile
- Deploy active content to `sound/mod/`
- Enable or disable sound modifications through `config.blk`
- Reconnect existing managed content
- Adopt unknown sound folders into the library
- Detect changed or partially managed installations
- Avoid deleting files Tailmark cannot verify it created

War Thunder and its launcher should be closed before activating or deactivating sound packages. Tailmark checks for this condition before writing.

### Managed collections, sights and hangars

- **Collections** let you group installed skins and activate only the group you want in `UserSkins`.
- **Custom sights** can be stored per-vehicle or as an `all_tanks` package and activated when needed.
- **Custom hangars** are imported as a package with a `.blk` configuration and `.bin` location file, then activated or deactivated safely.

### Background automation

- Watch a folder (Downloads by default) for completed skin ZIPs
- Automatically install high-confidence, skin-only archives
- Leave sounds, sights, hangars, mixed archives and uncertain downloads in the Installer queue for manual review
- Pause the watcher while Safe Mode is active or a recovery is pending
- Keep Tailmark in the system tray so the watcher runs without an open window

### Safety and recovery

- Create backups before replacement, merging, removal or activation
- Roll back failed installs automatically
- Keep restorable snapshots in the Library
- Configure backup retention
- Record installs, removals, activations and failures
- Export activity history for troubleshooting
- Preserve user data when the application is uninstalled
- Enter Safe Mode to temporarily restore managed content
- Resume or roll back interrupted operations from the recovery journal

### Queue management

The Installer includes filters for:

- Ready
- Problems
- User skins
- Sound mods

Each queue item can be inspected individually to review its destination, warnings and conflict state before the batch is committed.

### Appearance

Tailmark includes several interface themes, including:

- Everforest
- Catppuccin
- Nord
- Tokyo Night

Theme selection does not affect game files or installed packages.

## Installation

1. Open the [latest release](https://github.com/IEver3st/ThunderMod/releases/latest).
2. Download `Tailmark-Setup-<version>.exe`.
3. Run the installer.
4. Choose an installation directory.
5. Launch Tailmark from the Start Menu or desktop shortcut.

The installer does not modify War Thunder. Game files are touched only when the user performs an install or management operation.

## First launch

1. Open **Settings**.
2. Select the War Thunder directory containing `config.blk` and `aces.exe`.
3. Use automatic detection or browse to the directory manually.
4. Review import, backup and downloads automation behaviour.
5. Add one or more ZIP files to the Installer.
6. Inspect the proposed destinations before installing.

Archives can be analysed without a configured game path. Installation requires a verified War Thunder directory.

## Main sections

| Section | Purpose |
|---|---|
| Installer | Analyse archives, inspect problems and install ready items |
| Library | Manage skins, collections, sights, hangars, sound packages, profiles and backups |
| Activity | Review operations, errors and exported logs |
| Settings | Configure paths, conflicts, retention, automation and appearance |

## How installation works

```text
ZIP files
    |
    v
Archive scan
    |
    |-- Layout normalisation
    |-- Package classification
    |-- Duplicate detection
    |-- Conflict analysis
    |
    v
Proposed installation plan
    |
    v
User approval
    |
    |-- Backup existing content
    |-- Write files
    |-- Verify operation
    |-- Roll back on failure
```

## Data locations

Tailmark manages several categories of data in Electron's user-data directory:

- `state.json` - versioned settings, library metadata, profiles, backups, and history
- `library/skins/` - stored managed skin packages and collections
- `library/sounds/` - inactive managed sound packages
- `backups/` - restorable filesystem snapshots
- `temp/` - removable operation scratch space
- `operations/current.json` - recovery journal for interrupted operations

Files installed into the War Thunder directory, imported packages, backups, settings and activity records are kept separately.

Uninstalling Tailmark removes the application itself. It does not automatically remove imported packages, backups or user settings.

## Technology

| Layer | Technology |
|---|---|
| Desktop runtime | Electron 43 |
| Frontend | React 19 and TypeScript |
| Build tooling | Electron Vite and Vite |
| State | Zustand |
| Validation | Zod |
| Archive reading | yauzl |
| Archive writing | yazl |
| Packaging | electron-builder and NSIS |
| Image processing | Sharp |

## Development

### Prerequisites

- Node.js 22 or newer
- npm
- Windows for NSIS packaging
- A War Thunder installation for end-to-end testing

### Clone and install

```powershell
git clone https://github.com/IEver3st/ThunderMod.git
cd ThunderMod
npm install
```

### Run in development

```powershell
npm run dev
```

### Type checking

```powershell
npm run typecheck
```

### Build the application

```powershell
npm run build
```

### Build the Windows installer

```powershell
npm run dist:win
```

The resulting installer is named:

```text
Tailmark-Setup-<version>.exe
```

For example: `release/Tailmark-Setup-1.1.0.exe`.

### Architecture

```text
src/
├── main/
│   ├── archives/       streamed ZIP inspection, extraction, and normalisation
│   ├── backups/        restorable backup records
│   ├── config-blk/     brace-aware config editor
│   ├── detection/      game, mod-type, and active-sound detection
│   ├── filesystem/     path safety and transactional file operations
│   ├── installation/   skin installs and sound activation
│   ├── ipc/            validated Electron handlers
│   ├── library/        installed skin index
│   ├── management/     download watcher, managed content, operation journal
│   ├── persistence/    versioned atomic JSON storage
│   ├── processes/      Windows game-process checks
│   └── tray/           notification-area controller
├── preload/            typed, narrow context bridge
├── renderer/           React workbench and Zustand state
└── shared/             models, constants, Zod IPC schemas, and themes
```

The renderer has no Node.js or filesystem access. `contextIsolation`, the Chromium sandbox, and web security are enabled; `nodeIntegration` is disabled. The preload exposes only typed operations. Every renderer-controlled IPC argument is parsed again with bounded Zod schemas in the main process.

ZIPs are opened with `yauzl` in lazy-entry mode. Extraction uses per-entry streams and never executes archive content. The main process rejects traversal, absolute paths, alternate data streams, reserved Windows names, symbolic links, excessive depth, implausible compression ratios, excessive entry counts, and oversized expanded archives before committing content.

### War Thunder path detection

Detection runs at first launch when enabled and considers candidates in this order:

1. The previously saved path
2. Steam's default installation plus every library in `steamapps/libraryfolders.vdf`
3. Common standalone Gaijin locations under Program Files and Local AppData
4. A user-selected directory from **Select War Thunder Installation**

A directory is scored from concrete evidence. `config.blk` and `aces.exe` / `win64/aces.exe` are strong evidence; existing `UserSkins` and `sound` folders add confidence but are not required. A candidate needs the strong evidence combination before it is accepted. The selected path is revalidated before every install or sound activation.

### Folder normalisation

Normalisation is deterministic and runs before extraction:

- Loose skin files are wrapped in a Windows-safe folder derived from the ZIP basename.
- One valid existing skin parent is preserved without adding duplicate nesting.
- Single-child wrapper chains are flattened until direct, credible mod files are reached.
- `__MACOSX`, AppleDouble files, `.DS_Store`, `Thumbs.db`, and `desktop.ini` are ignored during structural reasoning.
- Independent credible sibling skin folders become separate destinations in a multi-skin plan.
- Sound packages are rooted at their actual `sound/mod` content; wrapper folders such as `<package>/sound/mod/` and `mod/` are removed so only the payload is deployed.
- Sights and hangars are validated for the files they need and scoped to the appropriate vehicle or `all_tanks` setting.
- README-style documentation is retained but does not affect classification.
- Mixed signals, unsafe entries, executable content, encryption, corruption, or speculative layouts remain in **Needs Review**.

Folder names preserve useful spaces and punctuation; only Windows-invalid characters, reserved device names, and invalid trailing characters are changed.

### Windows installer

Tailmark ships an assisted NSIS installer built with electron-builder. Branding is monochrome jet-and-mountain art.

#### Source art

| Role | Path |
| --- | --- |
| Installer banner (wordmark + jet scene) | `build/branding/tailmark-banner.png` |
| Installer sidebar art (jet + mountain) | `build/branding/tailmark-sidebar.png` |
| Application icon (square, preferred) | `build/icon.png` |

Replace those sources when branding changes, then regenerate derived assets.

#### Regenerate installer assets

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
- `build/installerHeader.bmp` (150x57)
- `build/installerSidebar.bmp` (164x314)
- `build/uninstallerSidebar.bmp` (164x314)
- `build/installer.nsh`

#### Build the installer

```powershell
npm run dist:win
```

This regenerates installer assets, typechecks, builds with electron-vite, then runs `electron-builder --win nsis`.

Output directory: `release/`

#### Installer behaviour

- Assisted installer (not one-click): directory selection, desktop and Start Menu shortcut options
- Current-user installation only (no all-users / install-mode page; `allowElevation: false`)
- Upgrades reuse the stable `appId` (`com.tailmark.app`) so Windows treats installs as the same product
- Uninstall removes the application files; Electron user-data (settings, imported sound packages, backups, activity) is left in place
- The installer does not modify War Thunder files

#### Code signing

Public distribution should use an Authenticode certificate. This repository does not embed signing credentials. To sign locally, configure electron-builder Windows signing via environment variables or `win` certificate settings (for example `CSC_LINK` / `CSC_KEY_PASSWORD`, or `win.certificateFile` / `win.certificatePassword`). Unsigned installers may show SmartScreen warnings; that is expected until a valid certificate is configured.

## Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start Electron Vite development mode |
| `npm run build` | Type-check and build the application |
| `npm run typecheck` | Run the TypeScript compiler only |
| `npm run assets:installer` | Generate installer artwork |
| `npm run dist:win` | Build the Windows NSIS installer |
| `npm run package:dir` | Create an unpacked application build |

## Testing archive behaviour

Mod management is unusually dependent on malformed inputs. Contributions should test packages such as:

- Loose user skin files
- One unnecessary wrapper directory
- Several nested wrappers
- Duplicate content with a different ZIP name
- Existing folder conflicts
- Mixed skin and sound content
- Empty archives
- Archives containing executables
- Interrupted writes
- Existing unmanaged sound folders

The fixture generator can be used to produce controlled test cases.

## Known constraints

- Windows 10 and Windows 11 are the supported platforms
- Only ZIP archives are analysed directly
- Sound activation requires the game and launcher to be closed
- Automatic detection cannot account for every custom installation path
- Downloads automation installs only high-confidence, skin-only archives
- Packaged installers are not code-signed, so Windows SmartScreen may warn
- Tailmark cannot guarantee the quality or compatibility of third-party mods
- Backups reduce risk, but users should still retain copies of irreplaceable custom work

## Contributing

Issues and pull requests are welcome.

For bug reports, include:

- Tailmark version
- War Thunder installation type, Steam or standalone
- The archive layout
- The selected conflict policy
- The relevant Activity log
- Whether rollback completed successfully

Do not upload copyrighted mod packages without permission. A minimal synthetic archive is preferable.

## Licence

Tailmark is distributed under the [MIT License](./LICENSE).

## Disclaimer

Tailmark is an unofficial community utility. It is not affiliated with, endorsed by or supported by Gaijin Entertainment.

War Thunder and its associated names and assets are trademarks of their respective owners.

---

<div align="center">

Know what an archive will do before it does it.

</div>
