# Jakite Agent — Desktop App con Electron

**Fecha:** 2026-03-11
**Proyecto:** `monitor_ai_agent`
**Brand inicial:** Jakite Agent
**Plataformas objetivo:** Windows, macOS, Linux
**Estado:** Aprobado

---

## 1. Contexto y objetivo

El agente actualmente es un CLI puro en Node.js/TypeScript que corre como daemon de sistema (cron/launchd/Task Scheduler). El objetivo es añadir:

1. Un **wizard de instalación** con interfaz gráfica para facilitar el onboarding
2. Una **app de escritorio** (system tray + ventana) para que el usuario pueda monitorizar el estado del agente en todo momento

El CLI existente se mantiene intacto para instalaciones headless/servidor.

---

## 2. Framework y stack

**Framework UI:** Electron
**Razón:** Mismo stack TypeScript/Node.js que el proyecto actual. Máxima reutilización de código. Ecosistema maduro. Funciona igual en Windows/macOS/Linux.
**Packaging:** `electron-builder` (sustituye a `pkg` para la distribución desktop)
**CLI standalone (`pkg`):** Se mantiene para uso headless

| Plataforma | Formato de distribución |
|---|---|
| Windows | NSIS installer `.exe` |
| macOS | `.dmg` |
| Linux | `.AppImage` / `.deb` |

---

## 3. Arquitectura de código

### Reorganización en capas (`src/`)

```
src/
├── core/                    # Lógica de negocio pura
│   ├── collectors/          # claude-code.ts, cursor.ts, vscode-copilot.ts
│   ├── analyzers/           # prompt-analyzer.ts, workflow-analyzer.ts
│   ├── config.ts
│   ├── crypto.ts
│   ├── sender.ts
│   ├── service.ts
│   ├── task-inference.ts
│   └── types.ts
├── cli/
│   └── index.ts             # Thin wrapper — mismos comandos CLI actuales
└── electron/
    ├── main.ts              # Main process (tray, ventanas, IPC)
    ├── preload.ts           # Bridge seguro renderer ↔ main
    ├── installer/
    │   ├── installer.html
    │   └── installer.ts     # Lógica del wizard
    └── app/
        ├── app.html
        └── app.ts           # Lógica de la ventana principal
```

Dos entry points, un mismo `core/`:
- `src/cli/index.ts` → importa `src/core/*`
- `src/electron/main.ts` → importa `src/core/*`

---

## 4. Sistema de brands (multi-tenant)

El agente soporta múltiples marcas desde el día 1. Solo se implementa **jakite** inicialmente.

```
brands/
├── jakite/
│   ├── brand.json       # Configuración de marca
│   ├── logo.png
│   ├── icon.ico         # Windows
│   ├── icon.icns        # macOS
│   └── icon.png         # Linux
└── aibl/                # Futuro — se añade sin tocar código
    └── brand.json
```

**Estructura de `brand.json`:**
```json
{
  "name": "Jakite Agent",
  "appId": "com.jakite.agent",
  "serverUrl": "https://jakite.tech",
  "primaryColor": "#6c63ff"
}
```

**Build con variable de entorno:**
```bash
BUILD_BRAND=jakite npm run build:electron
```

Todo el código usa `brand.name`, `brand.serverUrl`, etc. — cero hardcoding. GitHub Actions tendrá un workflow de release por brand.

**Roadmap AIBL:** Cuando se cree AIBL tendrá su propio backend y base de datos independiente. El instalador AIBL apuntará a su propio `serverUrl`. Sin dependencia de datos con jakite.

---

## 5. Wizard de instalación (5 pantallas)

### Flujo

```
[1. Bienvenida] → [2. Privacidad] → [3. Tecnologías] → [4. Instalando] → [5. Completado]
```

### Token embebido en la descarga

- El usuario descarga el instalador desde jakite.tech estando autenticado
- El endpoint `GET /api/download/installer?platform=win|mac|linux` genera una descarga con `agent-setup.json` empaquetado:
  ```json
  { "token": "abc123", "serverUrl": "https://jakite.tech" }
  ```
- Al arrancar el wizard, el main process lee `agent-setup.json` desde `resources/`
- El usuario nunca ve ni introduce el token manualmente

### Pantalla 1 — Bienvenida
Logo del brand, nombre de la app (`brand.name`), versión. Botón **Siguiente**. Sin inputs.

### Pantalla 2 — Política de privacidad
Texto scrolleable con la política completa. Botón **Siguiente** deshabilitado hasta llegar al final del scroll. Checkbox "He leído y acepto la política de privacidad". Al aceptar se guarda `consentGivenAt` en `config.json`.

### Pantalla 3 — Selección de tecnologías
Tres opciones con checkbox + descripción de qué captura cada una:

| Tecnología | Datos capturados |
|---|---|
| Claude Code | Sesiones, tokens, modelos, tipos de tarea |
| Cursor | Sesiones, modelos, actividad del chat IA |
| GitHub Copilot | Detección de instalación y extensiones activas |

Al menos una debe estar seleccionada para continuar. Esta selección se envía al servidor en la pantalla 4.

### Pantalla 4 — Instalando (progreso)

Pasos secuenciales con estado visual (pendiente / en curso / completado / error):

1. Validando token con el servidor (`/api/agent/heartbeat`)
2. Guardando configuración local
3. Instalando servicio del sistema (cron / launchd / Task Scheduler)
4. Registrando tecnologías seleccionadas en el servidor (`/api/agent/setup`)
5. Primer ciclo de captura de datos

Si un paso falla: muestra el error con opción de reintentar o saltar.

### Pantalla 5 — Completado
Mensaje de éxito. Checkbox **"Crear acceso directo en el escritorio"** (marcado por defecto). Botón **Finalizar** — lanza la app principal y cierra el wizard.

---

## 6. App de escritorio — System tray + ventana

### Comportamiento del tray

| Acción | Resultado |
|---|---|
| Click izquierdo en icono | Abre / muestra la ventana principal |
| Click derecho en icono | Menú contextual: Abrir, Cerrar aplicación |
| Cerrar la ventana (×) | Oculta la ventana; el agente sigue en background |
| "Cerrar aplicación" del menú | Cierra Electron completamente (el daemon del sistema continúa activo) |

### Layout de la ventana principal

```
┌─────────────────────────────────────────┐
│  [Logo]  Jakite Agent        [—] [×]    │
│                              v1.7.0     │
├─────────────────────────────────────────┤
│  ⚠ Nueva versión disponible: v1.8.0     │
│  [Descargar actualización]              │  ← solo si hay versión nueva
├─────────────────────────────────────────┤
│  API Key: abc1••••••••xyz9  [Mostrar]   │
├─────────────────────────────────────────┤
│  ÚLTIMO ENVÍO                           │
│  11 mar 2026 · 09:42:31                 │
│  3 herramientas · 47 sesiones           │
│                                         │
│  ACTIVIDAD DESDE EL ÚLTIMO ENVÍO        │
│  Claude Code   ████████░░  Alta         │
│  Cursor        ███░░░░░░░  Poca         │
│  Copilot       ──────────  Sin datos    │
│                                         │
│  Próximo envío estimado: ~8h            │
├─────────────────────────────────────────┤
│  [Desinstalar]              [Cerrar ×]  │
└─────────────────────────────────────────┘
```

### Elementos de la ventana

**Versión instalada** — Siempre visible en la esquina superior derecha del título.

**Banner de actualización** — Aparece solo si `heartbeat` devuelve una versión más nueva que la instalada. El botón "Descargar" abre `brand.serverUrl/download` en el navegador del sistema.

**API Key** — Enmascarada por defecto (`abc1••••••••xyz9`). Botón "Mostrar" revela el token completo. Permite al usuario verificar que coincide con el que muestra jakite.tech en su perfil.

**Último envío** — Fecha y hora exacta de `lastSentAt` del config. Si nunca se ha enviado: "Aún no se ha realizado ningún envío".

**Barras de actividad** — Una por tecnología habilitada. Miden sesiones capturadas desde `lastSentAt` vs baseline personal.

**Próximo envío estimado** — `lastSentAt + syncIntervalHours` - ahora.

**Botón Desinstalar** — Diálogo de confirmación → `serviceUninstall()` → elimina config → cierra app.

**Botón Cerrar** — Oculta la ventana (el agente sigue en tray).

---

## 7. Sistema de barras de actividad — Cálculo del nivel

### Baseline dinámico personal

Tras cada envío exitoso, se guarda en `config.json` el historial de sesiones:

```json
{
  "sendHistory": [
    { "sentAt": "2026-03-10T09:42:31Z", "sessions": { "claude-code": 12, "cursor": 8 } },
    { "sentAt": "2026-03-09T18:20:00Z", "sessions": { "claude-code": 9,  "cursor": 5 } }
  ]
}
```

Máximo 5 entradas (rolling). Se calcula la media de sesiones por ciclo de envío.

### Niveles

| Nivel | Condición | Color |
|---|---|---|
| Sin datos | 0 sesiones | Gris |
| Poca | < 50% de la media personal | Amarillo |
| Normal | 50%–150% de la media | Verde |
| Alta | > 150% de la media | Azul/Cyan |

**Primera vez (sin histórico):** umbrales fijos temporales — < 3 sesiones = poca, 3–10 = normal, > 10 = alta.

---

## 8. Cambios en el servidor (jakite — Nuxt server routes)

### Endpoints nuevos

**`POST /api/agent/setup`**
```json
// Request
{
  "token": "abc123",
  "enabledCollectors": ["claude-code", "cursor"],
  "agentVersion": "1.7.0",
  "platform": "win32"
}
// Response
{
  "syncIntervalHours": 15,
  "encryptionKey": "base64key...",
  "ok": true
}
```

Valida el token, registra tecnologías y plataforma para ese agente en DB, devuelve configuración inicial.

**`GET /api/download/installer?platform=win|mac|linux`**
Requiere sesión autenticada. Lee el token del usuario, empaqueta el instalador genérico + `agent-setup.json` y devuelve la descarga.

**`GET /api/agent/heartbeat`** (existente — añadir campo en respuesta)
```json
{
  "ok": true,
  "latestVersion": "1.8.0"   // ← nuevo campo
}
```

### Cambios en DB (jakite)

Nueva columna o tabla para registrar por agente:
- `enabledCollectors: string[]`
- `platform: string`
- `agentVersion: string`
- `installedAt: datetime`

> ⚠️ Verificar que el cambio de schema no rompe otras partes del monolito `monitor_ai` antes de migrar.

### Sección en perfil del usuario (jakite web)

Mostrar en la sección de instalación del usuario:
- Estado: "Agente instalado ✓" / "No instalado"
- API Key (enmascarada por defecto, con opción de mostrar)
- Plataforma y versión instalada
- Fecha de instalación

El usuario puede comparar visualmente que la API Key en jakite.tech coincide con la que muestra la ventana del agente.

---

## 9. Cambios en `config.json` del agente

```json
{
  "serverUrl": "https://jakite.tech",
  "authToken": "abc123",
  "syncIntervalHours": 15,
  "enabledCollectors": ["claude-code", "cursor"],
  "encryptionKey": "base64key...",
  "consentGivenAt": "2026-03-11T10:00:00Z",
  "lastSentAt": "2026-03-11T09:42:31Z",
  "sendHistory": [
    { "sentAt": "2026-03-11T09:42:31Z", "sessions": { "claude-code": 12, "cursor": 8 } }
  ]
}
```

`sendHistory` es nuevo — se actualiza en `core/sender.ts` tras cada envío exitoso.

---

## 10. Resumen de decisiones de diseño

| Decisión | Elección | Razón |
|---|---|---|
| Framework UI | Electron | Mismo stack TS/Node.js, máxima reutilización |
| Estructura de código | core / cli / electron | Boundaries claros, escalable |
| Multi-brand | Build-time via `brands/` | Sin tocar código al añadir nueva marca |
| Token en instalador | `agent-setup.json` embebido | UX sin fricción, el usuario nunca introduce credenciales |
| App en escritorio | System tray + ventana | Patrón estándar para agentes background |
| Nivel de actividad | Baseline dinámico personal | Se adapta al patrón de uso individual |
| Notificación de updates | Campo `latestVersion` en heartbeat | Reutiliza infraestructura existente |
