# Monitor IA Agent

[![Installation Tests](https://github.com/santisvs/monitor_ai_agent/actions/workflows/test-install.yml/badge.svg)](https://github.com/santisvs/monitor_ai_agent/actions/workflows/test-install.yml)

Agente de escritorio que recolecta métricas de uso de herramientas de IA locales (Claude Code, Cursor, VS Code Copilot) y las envía al servidor de Monitor AI.

## Instalación

```bash
# 1. Descargar el ejecutable para tu sistema operativo desde releases/
# 2. Configurar con tu token de Monitor AI
monitor-ia-agent setup <tu-token>

# 3. Instalar como servicio del sistema
monitor-ia-agent service install
```

## Comandos

| Comando | Descripción |
|---------|-------------|
| `setup <token>` | Configura el agente con tu token |
| `run-once` | Ejecuta una recolección manual |
| `service install` | Instala como servicio del sistema (cron/launchd/Task Scheduler) |
| `service status` | Muestra el estado del servicio |
| `service uninstall` | Desinstala el servicio |

## Plataformas soportadas

- **Linux**: cron (`crontab`)
- **macOS**: launchd (`launchctl bootstrap`) — compatible con macOS 13+
- **Windows**: Task Scheduler (`schtasks`)

## Desarrollo

```bash
npm install
npm run build      # Compila TypeScript
npm run bundle     # Bundle con ESBuild
npm run pkg:all    # Genera ejecutables para todos los sistemas
npm test           # Ejecuta tests
```
