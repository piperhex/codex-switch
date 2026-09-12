!include "${__FILEDIR__}\installer-backup-state.nsh"

!macro CswBackupRestore
  StrCpy $R0 0
  ${If} ${FileExists} "$CswBackupPath"
    !insertmacro CswRmStop "$INSTDIR\csw.exe"
    ${If} $R0 == 0
      !insertmacro CswRmStop "$CswBackupPath"
    ${EndIf}
    ${If} $R0 == 0
      ClearErrors
      ${If} ${FileExists} "$INSTDIR\csw.exe"
        Delete "$INSTDIR\csw.exe"
      ${EndIf}
      Rename "$CswBackupPath" "$INSTDIR\csw.exe"
      ${If} ${Errors}
        StrCpy $R0 1
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro CswBackupPrepare
  !insertmacro CswBackupLockOpen
  ${If} $R0 == 0
    ; Recover a prior interrupted installation before preparing this attempt.
    !insertmacro CswBackupRestore
  ${EndIf}
  ${If} $R0 == 0
    !insertmacro CswRmStop "$INSTDIR\csw.exe"
  ${EndIf}
  ${If} $R0 == 0
  ${AndIf} ${FileExists} "$INSTDIR\csw.exe"
    ClearErrors
    Rename "$INSTDIR\csw.exe" "$CswBackupPath"
    ${If} ${Errors}
      StrCpy $R0 1
    ${Else}
      ; Chrome can no longer restart the old path. Also close a process that raced
      ; the first shutdown: Windows permits renaming an executable that is running.
      !insertmacro CswRmStop "$CswBackupPath"
    ${EndIf}
  ${EndIf}
!macroend

!macro CswBackupCommit
  StrCpy $R0 0
  ${If} ${FileExists} "$CswBackupPath"
    ClearErrors
    Delete "$CswBackupPath"
    ${If} ${Errors}
      StrCpy $R0 1
    ${EndIf}
  ${EndIf}
!macroend

!macro CswInstallerCancel
  ${If} $CswBackupLockHeld == 1
    !insertmacro CswBackupRestore
  ${EndIf}
  ; Preserve any recoverable backup if cleanup fails; the next installer retries it.
  !insertmacro CswRmFinish
  !insertmacro CswBackupLockClose
!macroend

!macro CswInstallerComplete
  !insertmacro CswBackupCommit
  ${If} $R0 == 0
    !insertmacro CswRmFinish
  ${EndIf}
  ${If} $R0 == 0
    !insertmacro CswBackupLockClose
  ${EndIf}
!macroend
