; Tailmark NSIS customisation for electron-builder (include macros only).
; Do not replace the full installer script.

!macro customHeader
  BrandingText "Tailmark"
  !define MUI_FINISHPAGE_TITLE "Tailmark is ready"
  !define MUI_FINISHPAGE_TEXT "Tailmark was installed successfully.$\r$\n$\r$\nLaunch the application to locate War Thunder and manage user skins, sound mods, and profiles."
!macroend

; Force current-user install and skip the all-users / current-user choice page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Install Tailmark"
  !define MUI_WELCOMEPAGE_TEXT "Tailmark manages War Thunder user skins, sound mods and profiles.$\r$\n$\r$\nClose War Thunder before installing or updating Tailmark.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Uninstall Tailmark"
  !define MUI_WELCOMEPAGE_TEXT "This will remove the Tailmark application from this computer.$\r$\n$\r$\nImported packages, backups, and application data stored under Tailmark's user-data folder will remain unless you remove them separately.$\r$\n$\r$\nClick Uninstall to continue."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
