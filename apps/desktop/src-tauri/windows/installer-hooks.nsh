!define CSW_RM_FORCE_SHUTDOWN 1
!define CSW_ERROR_NOT_ENOUGH_MEMORY 8
Var CswRmSession
Var CswRmSessionActive

!macro CswRmOpen
  Push $0
  Push $1
  Push $2
  System::Call 'rstrtmgr::RmStartSession(*i .r0, i 0, w .r1) i .r2'
  StrCpy $R0 $2
  ${If} $R0 == 0
    StrCpy $CswRmSession $0
    ; Zero is a valid session handle, so track ownership separately.
    StrCpy $CswRmSessionActive 1
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro CswRmRegister resourcePath
  Push $0
  Push $1
  Push $2
  ; Register one Unicode file path, using the pointer width of the NSIS host.
  System::Call '*(&w${NSIS_MAX_STRLEN} "${resourcePath}") p.r0'
  System::Call '*(p r0) p.r1'
  StrCpy $R0 ${CSW_ERROR_NOT_ENOUGH_MEMORY}
  ${If} $0 P<> 0
  ${AndIf} $1 P<> 0
    System::Call 'rstrtmgr::RmRegisterResources(i $CswRmSession, i 1, p r1, i 0, p 0, i 0, p 0) i .r2'
    StrCpy $R0 $2
  ${EndIf}
  System::Free $1
  System::Free $0
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro CswRmStop resourcePath
  StrCpy $R0 0
  ${If} ${FileExists} "${resourcePath}"
    ; Restart Manager rejects additional resource registration after shutdown.
    !insertmacro CswRmFinish
    ${If} $R0 == 0
      !insertmacro CswRmOpen
    ${EndIf}
    ${If} $R0 == 0
      !insertmacro CswRmRegister "${resourcePath}"
    ${EndIf}
    ${If} $R0 == 0
      Push $0
      System::Call 'rstrtmgr::RmShutdown(i $CswRmSession, i ${CSW_RM_FORCE_SHUTDOWN}, p 0) i .r0'
      StrCpy $R0 $0
      Pop $0
    ${EndIf}
  ${EndIf}
!macroend

!macro CswRmFinish
  StrCpy $R0 0
  ${If} $CswRmSessionActive == 1
    Push $0
    System::Call 'rstrtmgr::RmEndSession(i $CswRmSession) i .r0'
    StrCpy $R0 $0
    Pop $0
    ${If} $R0 == 0
      StrCpy $CswRmSessionActive 0
    ${EndIf}
  ${EndIf}
!macroend

!include "${__FILEDIR__}\installer-backup.nsh"

; Restart Manager closes users of this installation's executable, including old
; versions without shutdown support. Never use Tauri's name-wide process kill.
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  !insertmacro CswBackupPrepare
  ${If} $R0 != 0
    !insertmacro CswInstallerCancel
    Abort "Please exit Codex Switch, then try again."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro CswInstallerComplete
  ${If} $R0 != 0
    Abort "Please close this installer, then try again."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro CswInstallerComplete
  ${If} $R0 != 0
    Abort "Please close this installer to finish."
  ${EndIf}
  RMDir "$INSTDIR"
!macroend

Function .onInstFailed
  !insertmacro CswInstallerCancel
FunctionEnd

Function un.onUninstFailed
  !insertmacro CswInstallerCancel
FunctionEnd

Function .onGUIEnd
  !insertmacro CswInstallerCancel
FunctionEnd

Function un.onGUIEnd
  !insertmacro CswInstallerCancel
FunctionEnd
