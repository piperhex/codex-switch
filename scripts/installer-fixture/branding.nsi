Unicode true
!include "LogicLib.nsh"
Name "Brand migration fixture"
OutFile "@output@"
RequestExecutionLevel user
SilentInstall silent
!define PRODUCTNAME "@name@"
!define CSW_LEGACY_PRODUCT_NAME "@name@-legacy"
!define MANUKEY "@registry@"
!define MANUPRODUCTKEY "@registry@\@name@"
!define MAINBINARYNAME "fixture"
; The fixture exercises registration and paths without creating user shortcuts.
!macro IsShortcutTarget shortcut target
  Push 0
!macroend
!include "@branding@"
!macro AssertEqual actual expected
  ${If} ${actual} != ${expected}
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend
Section
  SetShellVarContext current
  CreateDirectory "@directory@\legacy"
  FileOpen $0 "@directory@\legacy\fixture.exe" w
  FileClose $0
  WriteRegStr SHCTX "@registry@\@name@-legacy" "" "@directory@\legacy"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\@name@-legacy" "DisplayName" "legacy"

  ; A default fresh destination adopts the previous installation.
  StrCpy $INSTDIR "$LOCALAPPDATA\@name@"
  !insertmacro CswPrepareBrandMigration
  !insertmacro AssertEqual $INSTDIR '"@directory@\legacy"'
  !insertmacro AssertEqual $OUTDIR '"@directory@\legacy"'
  !insertmacro AssertEqual $CswBrandMigration 1
  ReadRegStr $0 SHCTX "@registry@\@name@-legacy" ""
  !insertmacro AssertEqual $0 '"@directory@\legacy"'

  ; An explicit destination must not retire another installation.
  StrCpy $INSTDIR "@directory@\separate"
  !insertmacro CswPrepareBrandMigration
  !insertmacro AssertEqual $CswBrandMigration 0
  !insertmacro CswFinishBrandMigration
  ReadRegStr $0 SHCTX "@registry@\@name@-legacy" ""
  !insertmacro AssertEqual $0 '"@directory@\legacy"'

  ; Updating in place removes legacy entries only after successful installation.
  StrCpy $INSTDIR "@directory@\legacy"
  !insertmacro CswPrepareBrandMigration
  !insertmacro AssertEqual $CswBrandMigration 1
  !insertmacro CswFinishBrandMigration
  ReadRegStr $0 SHCTX "@registry@\@name@-legacy" ""
  !insertmacro AssertEqual $0 '""'
  ReadRegStr $0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\@name@-legacy" "DisplayName"
  !insertmacro AssertEqual $0 '""'
SectionEnd
