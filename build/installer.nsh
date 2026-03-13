; Custom NSIS hooks for Jakite Agent installer/uninstaller

; Matar el proceso antes de instalar (evita el diálogo "app está activa")
!macro customInstall
  nsExec::ExecToLog 'taskkill /F /IM "Jakite Agent.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "jakite agent.exe" /T'
  Sleep 1000
!macroend

; Limpieza completa al desinstalar
!macro customUninstall
  ; Eliminar tareas programadas de Task Scheduler
  nsExec::ExecToLog 'schtasks /Delete /TN "MonitorIA-Agent-periodic" /F'
  nsExec::ExecToLog 'schtasks /Delete /TN "MonitorIA-Agent-startup" /F'
  nsExec::ExecToLog 'schtasks /Delete /TN "MonitorIA-Agent" /F'
  ; Eliminar directorio de datos del agente (~/.monitor-ia/)
  RMDir /r "$PROFILE\.monitor-ia"
!macroend
