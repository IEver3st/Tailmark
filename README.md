# Tailmark

Safe bulk installer and manager for War Thunder user skins and sound mods.

Tailmark inspects every ZIP before it touches your game folder, shows exactly where each package will go, backs up existing content, and lets you recover from mistakes.

## Requirements

- Windows 10 or Windows 11 (64-bit)
- A War Thunder installation (Steam or standalone)

## Install

1. Download `Tailmark-Setup-<version>.exe` from the latest release.
2. Run the installer and choose where to install Tailmark.
3. Launch Tailmark from the desktop or Start Menu shortcut.

The installer does not modify War Thunder files.

## First launch

1. Open **Settings**.
2. Point Tailmark at your War Thunder folder — the one that contains `config.blk` and `aces.exe`.
   - Use **Detect automatically** if Tailmark finds Steam or a common install path.
   - Or use **Select folder** and browse to the game directory yourself.
3. Pick a color theme if you want — Everforest, Catppuccin, Nord, Tokyo Night, and others are available under **Appearance**.

You can analyse ZIP files before the game path is set, but installs require a verified installation.

## Main sections

| Section | What it does |
| --- | --- |
| **Installer** | Drop or browse ZIP files and folders. Tailmark analyses each archive, classifies skins vs sound mods, flags problems, and installs ready items in batch. |
| **Library** | View installed skins, manage sound packages and profiles, and restore from backups. |
| **Activity** | Browse a history of installs, activations, removals, and errors. Export the log if you need it. |
| **Settings** | Game path, import behaviour, backup retention, and advanced sound options. |

## User skins

- Skins install into War Thunder's `UserSkins` folder.
- Drop any number of ZIP files onto the Installer, or add a whole folder of archives.
- Tailmark normalises messy archives — loose files, extra wrapper folders, and common junk like `__MACOSX` are handled automatically.
- **You can install skins while War Thunder is running.**

### Duplicates and name conflicts

In **Settings → Import behaviour**:

- **Ignore duplicate content** — skip skins whose files already match something installed, even if the ZIP name is different.
- **Existing folder behaviour** — what to do when a folder name already exists: skip, replace, merge, or install as a copy. Replace and merge always create a backup first.
- **Move source ZIP to Recycle Bin** — optionally clean up archives after a successful skin install.

## Sound mods

- Sound packages are saved in Tailmark's library and deployed to `<War Thunder>/sound/mod/`.
- Installing one sound archive creates a named profile and activates it immediately.
- Installing several sound archives at once imports them without activating — pick one profile or combine them in the Library.
- **Close War Thunder and the launcher before activating or deactivating sound mods.** Tailmark checks this before writing.

### Existing sound mods

If you already have content in `sound/mod/`, the Library can detect it. Tailmark distinguishes managed installs, exact matches it can reconnect, changed content, and unknown folders you can adopt into the library.

Deactivation is safe: Tailmark only deletes files it can verify it placed there. Otherwise it turns off `enable_mod` in `config.blk` and leaves your files alone.

## Safety and backups

Every replace, merge, removal, and sound activation can create a restorable backup before files change.

- Backups appear in **Library → Backups**.
- Failed installs roll back — you do not end up with a half-written folder.
- Tailmark never runs executable content found inside archives.
- Configure how many backups to keep under **Settings → Backup retention**.

## Tips

- Use the Installer queue filters (**Ready**, **Problems**, **Skins**, **Sounds**) to work through large batches quickly.
- Select an archive in the queue to inspect its proposed destination, warnings, and conflicts before installing.
- Check **Activity** if something unexpected happened — each operation is recorded with enough detail to diagnose issues.
- Uninstalling Tailmark removes the app only. Your settings, imported sound packages, backups, and activity history stay on disk until you delete them manually.

## License

MIT
