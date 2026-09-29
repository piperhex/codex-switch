; The former product name remains an installation identity for upgrades only.
!define /ifndef CSW_LEGACY_PRODUCT_NAME "Codex Switch"
Var CswLegacyInstallDirectory
Var CswBrandMigration

!macro CswPrepareBrandMigration
  Push $0
  StrCpy $CswBrandMigration 0
  ReadRegStr $CswLegacyInstallDirectory SHCTX "${MANUKEY}\${CSW_LEGACY_PRODUCT_NAME}" ""
  ${If} $CswLegacyInstallDirectory != ""
  ${AndIf} ${FileExists} "$CswLegacyInstallDirectory\${MAINBINARYNAME}.exe"
    ; Reuse an existing installation only when the default destination was chosen.
    ; Custom destinations (including the updater's /D argument) stay authoritative.
    ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" ""
    ${If} $0 == ""
    ${AndIf} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
      StrCpy $INSTDIR $CswLegacyInstallDirectory
      ; Tauri selects its output directory before running the preinstall hook.
      SetOutPath $INSTDIR
    ${EndIf}
    ${If} $INSTDIR == $CswLegacyInstallDirectory
      StrCpy $CswBrandMigration 1
    ${EndIf}
  ${EndIf}
  Pop $0
!macroend

!macro CswRenameBrandShortcut directory
  !insertmacro IsShortcutTarget "${directory}\${CSW_LEGACY_PRODUCT_NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 == 1
    ${If} ${FileExists} "${directory}\${PRODUCTNAME}.lnk"
      Delete "${directory}\${CSW_LEGACY_PRODUCT_NAME}.lnk"
    ${Else}
      Rename "${directory}\${CSW_LEGACY_PRODUCT_NAME}.lnk" "${directory}\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}
!macroend

!macro CswFinishBrandMigration
  ${If} $CswBrandMigration == 1
    Push $0
    Push $1
    Push $2
    Push $3
    ; Only retire the old registration after its executable was replaced successfully.
    DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${CSW_LEGACY_PRODUCT_NAME}"
    DeleteRegKey SHCTX "${MANUKEY}\${CSW_LEGACY_PRODUCT_NAME}"
    !insertmacro CswRenameBrandShortcut "$DESKTOP"
    !insertmacro CswRenameBrandShortcut "$SMPROGRAMS"
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
!macroend
