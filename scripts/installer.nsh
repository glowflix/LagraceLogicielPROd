# Script NSIS Personnalisé pour Glowflix POS
# Installation Professionnelle avec Auto-Launch en Admin

!include "MUI2.nsh"
!include "x64.nsh"

; Configuration générale
SetCompressor /SOLID lzma
SetDatablockOptimize on
SetDateSave off
SetOverwrite ifnewer

; Hook post-installation - LANCER AUTOMATIQUEMENT
Function .onInstSuccess
  ; Message de fin
  MessageBox MB_ICONINFORMATION "Installation Glowflix POS réussie !$\n$\nLe logiciel va démarrer..." IDOK
  
  ; Lancer le logiciel en admin
  ${If} ${RunningX64}
    ExecShell "runas" "$INSTDIR\Glowflix POS.exe"
  ${EndIf}
FunctionEnd

; Variables pour customization
Var InstallDir

; Définir chemins d'installation
!ifdef INSTALL_DIR
  InstallDir "${INSTALL_DIR}"
!else
  InstallDir "$PROGRAMFILES64\Glowflix\Glowflix POS"
!endif

