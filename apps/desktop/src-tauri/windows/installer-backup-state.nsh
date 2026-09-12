!define CSW_BACKUP_OWNER "Codex Switch installer backup v1"
; GENERIC_READ | GENERIC_WRITE | DELETE, and FILE_FLAG_DELETE_ON_CLOSE | FILE_ATTRIBUTE_HIDDEN.
!define CSW_LOCK_ACCESS 0xC0010000
!define CSW_LOCK_FLAGS 0x04000002
!define CSW_OPEN_ALWAYS 4
Var CswBackupDirectory
Var CswBackupPath
Var CswBackupLock
Var CswBackupLockHeld

!macro CswBackupIdentify
  Push $0
  Push $1
  StrCpy $R0 0
  StrCpy $CswBackupDirectory "$INSTDIR\.csw-installer-backup"
  StrCpy $CswBackupPath "$CswBackupDirectory\csw.exe"
  ${If} ${FileExists} "$CswBackupDirectory\owner"
    ClearErrors
    FileOpen $0 "$CswBackupDirectory\owner" r
    FileRead $0 $1
    FileClose $0
    ${If} ${Errors}
    ${OrIf} $1 != "${CSW_BACKUP_OWNER}"
      StrCpy $R0 1
    ${EndIf}
  ${Else}
    ; An unmarked directory is claimable only when empty. Never overwrite its files.
    ${If} ${FileExists} "$CswBackupDirectory"
      ClearErrors
      RMDir "$CswBackupDirectory"
      ${If} ${Errors}
        StrCpy $R0 1
      ${EndIf}
    ${EndIf}
    ${If} $R0 == 0
      ClearErrors
      CreateDirectory "$CswBackupDirectory"
      FileOpen $0 "$CswBackupDirectory\owner" w
      FileWrite $0 "${CSW_BACKUP_OWNER}"
      FileClose $0
      ${If} ${Errors}
        StrCpy $R0 1
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro CswBackupLockOpen
  !insertmacro CswBackupIdentify
  ${If} $R0 == 0
    Push $0
    ; OPEN_ALWAYS with no sharing: Windows releases the lock even if this installer crashes.
    StrCpy $0 "$CswBackupDirectory\lock"
    System::Call \
      'kernel32::CreateFileW(w r0, i ${CSW_LOCK_ACCESS}, i 0, p 0, i ${CSW_OPEN_ALWAYS}, i ${CSW_LOCK_FLAGS}, p 0) p.r0'
    ${If} $0 P= -1
      StrCpy $R0 1
    ${Else}
      StrCpy $CswBackupLock $0
      StrCpy $CswBackupLockHeld 1
    ${EndIf}
    Pop $0
  ${EndIf}
!macroend

!macro CswBackupLockClose
  ${If} $CswBackupLockHeld == 1
    ; Retain a marked backup after failed recovery. Cleanup never removes unknown files.
    ${IfNot} ${FileExists} "$CswBackupPath"
      Delete "$CswBackupDirectory\owner"
    ${EndIf}
    Push $0
    System::Call 'kernel32::CloseHandle(p $CswBackupLock) i .r0'
    ${If} $0 == 0
      StrCpy $R0 1
    ${EndIf}
    Pop $0
    StrCpy $CswBackupLockHeld 0
    ; A competing installer may already own this directory; nonrecursive removal is safe.
    RMDir "$CswBackupDirectory"
  ${EndIf}
!macroend
