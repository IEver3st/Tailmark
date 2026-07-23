<div align="center">

# Tailmark

### A safer installer and manager for War Thunder user skins and sound mods

Inspect archives before installation, resolve conflicts deliberately and recover from mistakes through automatic backups.

[![Latest Release](https://img.shields.io/github/v/release/IEver3st/Tailmark?display_name=tag&sort=semver)](../../releases/latest)
[![Downloads](https://img.shields.io/github/downloads/IEver3st/Tailmark/total)](../../releases)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows)](../../releases/latest)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron)](https://www.electronjs.org/)
[![Licence](https://img.shields.io/badge/licence-MIT-green)](#licence)

[Download](../../releases/latest) · [Report an issue](../../issues/new)

</div>

<!--
Add a screenshot of the Installer queue here.
Recommended path: docs/media/tailmark-installer.png
-->

## Overview

Tailmark is a Windows desktop manager for War Thunder user skins and sound modifications.

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

Tailmark normalises these layouts, explains what it found and lets the user decide what should happen before any game files are changed.

## Features

### Archive inspection

- Drag and drop one or more ZIP files
- Import an entire folder of archives
- Inspect archive contents before installation
- Classify packages as user skins or sound mods
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

### Safety and recovery

- Create backups before replacement, merging, removal or activation
- Roll back failed installs automatically
- Keep restorable snapshots in the Library
- Configure backup retention
- Record installs, removals, activations and failures
- Export activity history for troubleshooting
- Preserve user data when the application is uninstalled

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

1. Open the [latest release](../../releases/latest).
2. Download `Tailmark-Setup-<version>.exe`.
3. Run the installer.
4. Choose an installation directory.
5. Launch Tailmark from the Start Menu or desktop shortcut.

The installer does not modify War Thunder. Game files are touched only when the user performs an install or management operation.

## First launch

1. Open **Settings**.
2. Select the War Thunder directory containing `config.blk` and `aces.exe`.
3. Use automatic detection or browse to the directory manually.
4. Review import and backup behaviour.
5. Add one or more ZIP files to the Installer.
6. Inspect the proposed destinations before installing.

Archives can be analysed without a configured game path. Installation requires a verified War Thunder directory.

## Main sections

| Section | Purpose |
|---|---|
| Installer | Analyse archives, inspect problems and install ready items |
| Library | Manage skins, sound packages, profiles and backups |
| Activity | Review operations, errors and exported logs |
| Settings | Configure paths, conflicts, retention and appearance |

## How installation works

```text
ZIP files
    │
    ▼
Archive scan
    │
    ├── Layout normalisation
    ├── Package classification
    ├── Duplicate detection
    └── Conflict analysis
    │
    ▼
Proposed installation plan
    │
    ▼
User approval
    │
    ├── Backup existing content
    ├── Write files
    ├── Verify operation
    └── Roll back on failure
```

## Data locations

Tailmark manages three distinct categories of data:

- Files installed into the War Thunder directory
- Imported sound packages held in Tailmark's library
- Backups, settings and activity records held in application data

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
| Testing | Vitest |
| Image processing | Sharp |

## Development

### Prerequisites

- Node.js 22 or newer
- npm
- Windows for NSIS packaging
- A War Thunder installation for end-to-end testing

### Clone and install

```powershell
git clone https://github.com/IEver3st/Tailmark.git
cd Tailmark
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

### Tests

```powershell
npm run test
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

## Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start Electron Vite development mode |
| `npm run build` | Type-check and build the application |
| `npm run test` | Run the Vitest suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run fixtures` | Generate test archive fixtures |
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

Tailmark is distributed under the MIT Licence.

Add a root `LICENSE` file if one is not already present so the repository licence is detected correctly by GitHub.

## Disclaimer

Tailmark is an unofficial community utility. It is not affiliated with, endorsed by or supported by Gaijin Entertainment.

War Thunder and its associated names and assets are trademarks of their respective owners.

---

<div align="center">

Know what an archive will do before it does it.

</div>
