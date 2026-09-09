!include "${__FILEDIR__}\..\target\installer-helper-path.nsh"

!macro CswHelper operation
  InitPluginsDir
  ; The guard keeps this executable open until finish; extract it only once per installer.
  ${IfNot} ${FileExists} "$PLUGINSDIR\csw-installer-helper.exe"
    File /oname=$PLUGINSDIR\csw-installer-helper.exe "${CSW_HELPER_PATH}"
  ${EndIf}
  nsExec::ExecToStack '"$PLUGINSDIR\csw-installer-helper.exe" ${operation} "$INSTDIR\csw.exe"'
  Pop $R0
  Pop $R1
!macroend

; Replace Tauri's name-wide process kill with the same exact-path shutdown used by MSI.
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  !insertmacro CswHelper stop
  ${If} $R0 != 0
    Abort "Please exit Codex Switch, then try again."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro CswHelper finish
  ${If} $R0 != 0
    Abort "Please close this installer, then open Codex Switch again."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro CswHelper finish
  ${If} $R0 != 0
    Abort "Please close this installer to finish."
  ${EndIf}
!macroend

Function .onInstFailed
  !insertmacro CswHelper finish
FunctionEnd

Function un.onUninstFailed
  !insertmacro CswHelper finish
FunctionEnd
