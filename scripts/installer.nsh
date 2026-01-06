; electron-builder NSIS include fragment.
; IMPORTANT: This file must only define macros/callback fragments, not a full NSIS script.

!macro customInstall
  ; ---- Ensure legacy data dir exists and is writable by standard users ----
  CreateDirectory "C:\\Glowflixprojet"
  CreateDirectory "C:\\Glowflixprojet\\printer"
  CreateDirectory "C:\\Glowflixprojet\\printer\\jobs"
  CreateDirectory "C:\\Glowflixprojet\\printer\\ok"
  CreateDirectory "C:\\Glowflixprojet\\printer\\err"
  CreateDirectory "C:\\Glowflixprojet\\printer\\tmp"
  CreateDirectory "C:\\Glowflixprojet\\printer\\logs"
  CreateDirectory "C:\\Glowflixprojet\\printer\\templates"
  CreateDirectory "C:\\Glowflixprojet\\printer\\assets"

  ; Grant Modify to Builtin Users via SID (works on FR/EN Windows)
  ; S-1-5-32-545 = Builtin Users
  ExecWait '"$SYSDIR\\cmd.exe" /C icacls C:\\Glowflixprojet /grant *S-1-5-32-545:(OI)(CI)M /T /C'

  DetailPrint "C:\\Glowflixprojet créé + ACL Users=Modify"

  ; ---- Optional: install SumatraPDF system-wide (app also ships a bundled Sumatra) ----
  CreateDirectory "$PROGRAMFILES64\\SumatraPDF"
  SetOutPath "$PROGRAMFILES64\\SumatraPDF"
  CopyFiles /SILENT "$INSTDIR\\resources\\vendor\\sumatra\\SumatraPDF.exe" "$PROGRAMFILES64\\SumatraPDF\\SumatraPDF.exe"
  IfFileExists "$PROGRAMFILES64\\SumatraPDF\\SumatraPDF.exe" 0 +4
    WriteRegStr HKLM "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\SumatraPDF.exe" "" "$PROGRAMFILES64\\SumatraPDF\\SumatraPDF.exe"
    WriteRegStr HKLM "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\SumatraPDF.exe" "Path" "$PROGRAMFILES64\\SumatraPDF"
    DetailPrint "SumatraPDF installé dans $PROGRAMFILES64\\SumatraPDF"
!macroend

!macro customUnInstall
  ; Remove SumatraPDF installed by this installer (does not touch a user's own installation)
  Delete "$PROGRAMFILES64\\SumatraPDF\\SumatraPDF.exe"
  RMDir "$PROGRAMFILES64\\SumatraPDF"
  DeleteRegKey HKLM "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\SumatraPDF.exe"
!macroend

