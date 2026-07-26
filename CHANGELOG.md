# Changelog

All notable changes to Tailmark are documented in this file.

## [1.1.0] - 2026-07-26

### Added

- **Downloads automation** - Tailmark can watch a folder (Downloads by default) for completed skin ZIPs and install high-confidence, skin-only archives automatically. The watcher pauses for Safe Mode or pending recovery and shows status in the Library.
- **System tray mode** - Close the main window and keep Tailmark running in the Windows notification area so downloads automation and other background work stays alive.
- **Managed skin collections** - Group installed skins into named collections and activate one collection at a time to control which skins are physically present in `UserSkins`.
- **Custom sights** - Import, store, and activate per-vehicle or `all_tanks` sight packages from the Library.
- **Custom hangars** - Import, store, and activate hangar packages that include a `.blk` configuration and a `.bin` location file.
- **Safe Mode** - Temporarily restore managed content and block new writes until you choose to resume or roll back.
- **Recovery journal** - Resume or roll back interrupted operations safely.
- **Library totals** - The Library now shows total installed size for skins, sounds, and backups, plus size and file count for each package.
- **Transparent branding** - Top-left header branding is separate from the app icon; installer and application branding use transparent-background source art.
- **Installer icon resource** - `build/icon.ico` is bundled as an extra resource so the tray icon works in packaged builds.

### Changed

- The **Ignore duplicate content** setting is now applied to the installer queue, automatically skipping or marking fully duplicate skin and sound archives.
- Source ZIP cleanup to the Recycle Bin is now coordinated between the installer and downloads automation; failed archives are left in place.
- Library UI cleaned up to avoid redundant "ready" labels on already-installed items.
- Title bar and window controls restyled to match the new branding.
- Downloads automation scans the watch folder concurrently using the existing `mapWithConcurrency` helper.

## [1.0.0] - 2026-07-22

### Added

- Initial public release of Tailmark.
- Safe bulk installer for War Thunder user skins and sound mods.
- ZIP inspection, normalisation, and conflict detection.
- Backup and rollback for every game-directory write.
- War Thunder installation detection (saved, Steam, Gaijin, manual).
- Theme support (Everforest, Catppuccin, Nord, Tokyo Night).
