!include "${__FILEDIR__}\..\target\installer-helper-path.nsh"

!define CSW_INSTALLED_HELPER "$INSTDIR\csw-installer-helper.exe"
!define CSW_HELPER_CLEANUP_ATTEMPTS 30
!define CSW_HELPER_CLEANUP_DELAY_MS 100
Var CswHelperPrepared

!macro CswHelperRun operation
  ClearErrors
  ExecWait '"${CSW_INSTALLED_HELPER}" ${operation} "$INSTDIR\csw.exe"' $R0
  ${If} ${Errors}
    StrCpy $R0 1
  ${EndIf}
!macroend

!macro CswHelperStop
  StrCpy $R0 0
  ; A fresh installation has no process to stop and needs no helper executable.
  ${If} ${FileExists} "$INSTDIR\csw.exe"
    ${If} $CswHelperPrepared != 1
      ; Always use this installer's embedded copy, never an existing executable.
      ; Keep it in the installation directory while its guard is running.
      SetOverwrite on
      ClearErrors
      File "/oname=${CSW_INSTALLED_HELPER}" "${CSW_HELPER_PATH}"
      SetOverwrite lastused
      ${If} ${Errors}
        StrCpy $R0 1
      ${Else}
        StrCpy $CswHelperPrepared 1
      ${EndIf}
    ${EndIf}
    ${If} $R0 = 0
      !insertmacro CswHelperRun stop
    ${EndIf}
  ${EndIf}
!macroend

!macro CswHelperCleanup
  ; The gate can be released just before Windows closes the guard's image.
  StrCpy $R1 ${CSW_HELPER_CLEANUP_ATTEMPTS}
  ${Do}
    ClearErrors
    Delete "${CSW_INSTALLED_HELPER}"
    ${IfNot} ${Errors}
      StrCpy $CswHelperPrepared 0
      ${ExitDo}
    ${EndIf}
    Sleep ${CSW_HELPER_CLEANUP_DELAY_MS}
    IntOp $R1 $R1 - 1
  ${LoopWhile} $R1 > 0
  ${If} $CswHelperPrepared = 1
    StrCpy $R0 1
  ${EndIf}
!macroend

!macro CswHelperFinish
  StrCpy $R0 0
  ${If} $CswHelperPrepared = 1
    !insertmacro CswHelperRun finish
    ${If} $R0 = 0
      !insertmacro CswHelperCleanup
    ${EndIf}
  ${EndIf}
!macroend

; Replace Tauri's name-wide process kill with the same exact-path shutdown used by MSI.
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  !insertmacro CswHelperStop
  ${If} $R0 != 0
    Abort "Please exit Codex Switch, then try again."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro CswHelperFinish
  ${If} $R0 != 0
    Abort "Please close this installer, then open Codex Switch again."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro CswHelperFinish
  ${If} $R0 != 0
    Abort "Please close this installer to finish."
  ${EndIf}
  ; Tauri's earlier removal attempt runs while the helper still occupies this directory.
  RMDir "$INSTDIR"
!macroend

Function .onInstFailed
  !insertmacro CswHelperFinish
FunctionEnd

Function un.onUninstFailed
  !insertmacro CswHelperFinish
FunctionEnd
