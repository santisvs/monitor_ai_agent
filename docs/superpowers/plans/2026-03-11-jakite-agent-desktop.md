# Jakite Agent Desktop App Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform monitor_ai_agent from a headless CLI daemon into a full desktop application with an Electron installer wizard (5 screens) and a system tray app with status window.

**Architecture:** Reorganize `src/` into three layers — `src/core/` (business logic), `src/cli/` (thin CLI wrapper), `src/electron/` (Electron UI). Both CLI and Electron import from `core/`. A `brands/` directory enables white-labeling at build time via `BUILD_BRAND` env var. The CLI standalone binary (`pkg`) is preserved for headless use.

**Tech Stack:** Electron v28+, electron-builder v24+, TypeScript (CommonJS for Electron), esbuild, Node.js v20, Vitest

**Spec:** `docs/superpowers/specs/2026-03-11-jakite-agent-desktop-design.md`

---

## File Map

### Files to move (via `git mv`)

| From | To |
|---|---|
| `src/collectors/` | `src/core/collectors/` |
| `src/analyzers/` | `src/core/analyzers/` |
| `src/config.ts` | `src/core/config.ts` |
| `src/crypto.ts` | `src/core/crypto.ts` |
| `src/sender.ts` | `src/core/sender.ts` |
| `src/service.ts` | `src/core/service.ts` |
| `src/task-inference.ts` | `src/core/task-inference.ts` |
| `src/types.ts` | `src/core/types.ts` |
| `src/index.ts` | `src/cli/index.ts` |

### New files to create

| File | Responsibility |
|---|---|
| `brands/jakite/brand.json` | Brand config: name, appId, serverUrl, primaryColor |
| `brands/jakite/icons/icon.png` | Tray + app icon (Linux / generic, 512×512) |
| `brands/jakite/icons/icon.ico` | Windows installer + app icon (multi-res) |
| `brands/jakite/icons/icon.icns` | macOS app icon (multi-res) |
| `src/electron/brand.ts` | Brand config loader (reads BUILD_BRAND, returns typed config) |
| `src/electron/activity.ts` | Activity level calculator (baseline logic) |
| `src/electron/ipc-types.ts` | Shared IPC type definitions (AgentStatus, ActivityItem, etc.) |
| `src/electron/main.ts` | Electron main process: tray, window management, all IPC handlers |
| `src/electron/preload.ts` | Context bridge exposing electronAPI to renderers |
| `src/electron/installer/installer.html` | Wizard HTML — 5 screens in a single page |
| `src/electron/installer/installer.ts` | Wizard renderer logic (screen transitions, IPC calls) |
| `src/electron/app/app.html` | Main window HTML |
| `src/electron/app/app.ts` | Main window renderer logic |
| `electron-builder.config.js` | Packaging config for electron-builder (brand-aware) |
| `tsconfig.electron.json` | TypeScript config for Electron (CommonJS, includes core/) |
| `resources/agent-setup.example.json` | Example of the token file embedded by jakite download endpoint |

### Files to modify

| File | Change |
|---|---|
| `package.json` | Add electron + electron-builder deps; new build scripts; update `main` field |
| `tsconfig.json` | Exclude `src/electron/` (handled by tsconfig.electron.json) |
| `src/core/config.ts` | Add `SendHistoryEntry` type, `sendHistory`, `latestAgentVersion` fields; add `updateSendHistory()` |
| `src/cli/index.ts` | Update all imports to `../core/*`; update sendHistory after successful send; store latestAgentVersion from heartbeat |
| `vitest.config.ts` | Update include patterns to cover `src/core/` and `tests/` |
| `.gitignore` | Add `dist/electron/`, `releases/jakite/`, `.superpowers/` |
| `tests/**` | Update imports from `../../src/xxx` to `../../src/core/xxx` |

---

## Chunk 1: Core Layer Refactoring

Move all business logic to `src/core/`, thin-wrap CLI at `src/cli/`, add sendHistory to config, verify all tests pass.

### Task 1.1: Move source files to `src/core/`

**Files:**
- Move: all files listed in the file map above (via `git mv`)
- Modify: `src/cli/index.ts` (imports), `package.json` (bin), `tsconfig.json` (exclude)
- Modify: `tests/**` (imports)

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/core/collectors src/core/analyzers src/cli
```

- [ ] **Step 2: Move all files with git mv**

```bash
git mv src/collectors/claude-code.ts src/core/collectors/claude-code.ts
git mv src/collectors/cursor.ts src/core/collectors/cursor.ts
git mv src/collectors/vscode-copilot.ts src/core/collectors/vscode-copilot.ts
git mv src/analyzers/prompt-analyzer.ts src/core/analyzers/prompt-analyzer.ts
git mv src/analyzers/workflow-analyzer.ts src/core/analyzers/workflow-analyzer.ts
git mv src/config.ts src/core/config.ts
git mv src/crypto.ts src/core/crypto.ts
git mv src/sender.ts src/core/sender.ts
git mv src/service.ts src/core/service.ts
git mv src/task-inference.ts src/core/task-inference.ts
git mv src/types.ts src/core/types.ts
git mv src/index.ts src/cli/index.ts
```

- [ ] **Step 3: Verify relative imports within core/ are unchanged**

The files in `src/core/collectors/` previously imported from `'../types'`. Since both moved together, relative paths are unchanged. Verify by reading each collector file and confirming no broken imports:

```bash
grep -n "from '\.\." src/core/collectors/claude-code.ts
grep -n "from '\.\." src/core/collectors/cursor.ts
grep -n "from '\.\." src/core/collectors/vscode-copilot.ts
grep -n "from '\.\." src/core/analyzers/prompt-analyzer.ts
grep -n "from '\.\." src/core/analyzers/workflow-analyzer.ts
```

Expected: all paths like `'../types'`, `'../config'` — these still resolve correctly within `src/core/`.

- [ ] **Step 4: Update all imports in `src/cli/index.ts`**

Change every `'./xxx'` import to `'../core/xxx'`. Example:

```typescript
// Before
import { loadConfig, saveConfig, configExists, getConfigDir } from './config.js'
import { sendMetrics } from './sender.js'
import { serviceInstall, serviceUninstall, serviceStatus } from './service.js'
import { CollectorResult } from './types.js'

// After
import { loadConfig, saveConfig, configExists, getConfigDir } from '../core/config.js'
import { sendMetrics } from '../core/sender.js'
import { serviceInstall, serviceUninstall, serviceStatus } from '../core/service.js'
import { CollectorResult } from '../core/types.js'
```

Apply this to ALL imports in the file. Read the file first to catch every import.

- [ ] **Step 5: Update `package.json` bin entry and bundle/pkg scripts**

```json
"bin": {
  "monitor-ia-agent": "./dist/cli/index.js"
},
"main": "dist/electron/main.js"
```

Note: `main` now points to the Electron entry. The CLI is accessed via `bin` only.

Also update the `bundle` script entry point (currently hardcoded to `src/index.ts`):

```json
"bundle": "esbuild src/cli/index.ts --bundle --platform=node --target=node20 --outfile=bundle/agent.cjs ..."
```

Read the current `bundle` script first and update only the entry point path. All `pkg:*` scripts reference `bundle/agent.cjs` so they do not need changes — only the esbuild entry point moves.

- [ ] **Step 6: Update `tsconfig.json` to exclude electron/**

Add to `exclude`:
```json
"exclude": ["src/electron/**", "node_modules", "tests/**"]
```

Ensure `rootDir` covers both `src/core` and `src/cli`:
```json
"rootDir": "src"
```

- [ ] **Step 7: Update test imports**

Find all test files that import from `../../src/`:
```bash
grep -r "from '../../src/" tests/
```

Replace each `../../src/xxx` with `../../src/core/xxx` for all non-index files. For anything that imported from `src/index.ts`, update to `../../src/cli/index.js`.

- [ ] **Step 8: Run build to verify no TypeScript errors**

```bash
npm run build
```

Expected: Compiles without errors. `dist/cli/index.js` exists.

- [ ] **Step 9: Run tests**

```bash
npm test
```

Expected: All existing tests pass. Zero failures.

- [ ] **Step 10: Verify CLI still works**

```bash
node dist/cli/index.js --help
```

Expected: Displays the help text identical to before the refactor.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: reorganize src into core/ and cli/ layers"
```

---

### Task 1.2: Add `sendHistory` and `latestAgentVersion` to config

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/cli/index.ts`
- Create: `tests/core/config.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/core/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { updateSendHistory } from '../../src/core/config.js'
import type { SendHistoryEntry } from '../../src/core/config.js'

describe('updateSendHistory', () => {
  it('adds new entry to empty history', () => {
    const result = updateSendHistory([], '2026-03-11T09:00:00Z', { 'claude-code': 5, 'cursor': 3 })
    expect(result).toHaveLength(1)
    expect(result[0].sessions['claude-code']).toBe(5)
    expect(result[0].sessions['cursor']).toBe(3)
    expect(result[0].sentAt).toBe('2026-03-11T09:00:00Z')
  })

  it('keeps maximum 5 entries, dropping the oldest', () => {
    const existing: SendHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      sentAt: `2026-03-0${i + 1}T09:00:00Z`,
      sessions: { 'claude-code': i }
    }))
    const result = updateSendHistory(existing, '2026-03-11T09:00:00Z', { 'claude-code': 99 })
    expect(result).toHaveLength(5)
    expect(result[4].sessions['claude-code']).toBe(99)
    expect(result[0].sessions['claude-code']).toBe(1) // oldest dropped
  })

  it('appends to existing history under 5 entries', () => {
    const existing: SendHistoryEntry[] = [
      { sentAt: '2026-03-10T09:00:00Z', sessions: { 'claude-code': 10 } }
    ]
    const result = updateSendHistory(existing, '2026-03-11T09:00:00Z', { 'claude-code': 7 })
    expect(result).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/core/config.test.ts
```

Expected: FAIL — `updateSendHistory is not a function`

- [ ] **Step 3: Add types and function to `src/core/config.ts`**

Add to the file:

```typescript
export interface SendHistoryEntry {
  sentAt: string
  sessions: Record<string, number>
}
```

Add to `AgentConfig` interface:
```typescript
sendHistory?: SendHistoryEntry[]
latestAgentVersion?: string
```

Add function:
```typescript
export function updateSendHistory(
  history: SendHistoryEntry[],
  sentAt: string,
  sessions: Record<string, number>
): SendHistoryEntry[] {
  const updated = [...history, { sentAt, sessions }]
  return updated.slice(-5)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/core/config.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Verify `sendMetrics` return value before using it**

Read `src/core/sender.ts` and confirm `sendMetrics()` returns `Promise<boolean>` (true on success, false on failure). If it returns `void`, update it to `return true` on success and `return false` on failure before proceeding.

```bash
grep -n "return" src/core/sender.ts
```

Expected: A `return true` or `return false` pattern. If not found, add them.

- [ ] **Step 6: Update `runOnce` in `src/cli/index.ts` to save sendHistory**

After the successful `sendMetrics()` call, add:

```typescript
if (sent) {
  const sessions: Record<string, number> = {}
  for (const r of results) {
    const total = (r.metrics as any).totalSessions ?? (r.metrics as any).sessions ?? 0
    sessions[r.tool] = typeof total === 'number' ? total : 0
  }
  config.lastSentAt = new Date().toISOString()
  config.sendHistory = updateSendHistory(config.sendHistory ?? [], config.lastSentAt, sessions)
  await saveConfig(config)
}
```

Import `updateSendHistory` from `'../core/config.js'`.

- [ ] **Step 7: Update `sendHeartbeat` in `src/cli/index.ts` to store `latestAgentVersion`**

After receiving a successful heartbeat response, parse and store the version:

```typescript
if (response.ok) {
  const data = await response.json() as { latestVersion?: string }
  if (data.latestVersion && data.latestVersion !== config.latestAgentVersion) {
    config.latestAgentVersion = data.latestVersion
    await saveConfig(config)
  }
}
```

- [ ] **Step 8: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/core/config.ts src/cli/index.ts tests/core/config.test.ts
git commit -m "feat(core): add sendHistory and latestAgentVersion tracking to config"
```

---

## Chunk 2: Brand System + Electron Project Setup

### Task 2.1: Brand system

**Files:**
- Create: `brands/jakite/brand.json`
- Create: `brands/jakite/icons/` (placeholder icon files)
- Create: `src/electron/brand.ts`
- Create: `tests/electron/brand.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/electron/brand.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('loadBrandConfig', () => {
  const originalBrand = process.env.BUILD_BRAND

  afterEach(() => {
    process.env.BUILD_BRAND = originalBrand
    // Reset module cache so env changes take effect
    vi.resetModules()
  })

  it('loads jakite brand with correct fields', async () => {
    process.env.BUILD_BRAND = 'jakite'
    const { loadBrandConfig } = await import('../../src/electron/brand.js')
    const brand = loadBrandConfig()
    expect(brand.name).toBe('Jakite Agent')
    expect(brand.appId).toBe('com.jakite.agent')
    expect(brand.serverUrl).toMatch(/jakite/)
    expect(brand.primaryColor).toMatch(/^#/)
  })

  it('throws if BUILD_BRAND is not set', async () => {
    delete process.env.BUILD_BRAND
    const { loadBrandConfig } = await import('../../src/electron/brand.js')
    expect(() => loadBrandConfig()).toThrow('BUILD_BRAND')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/electron/brand.test.ts
```

Expected: FAIL — `Cannot find module '../../src/electron/brand.js'`

- [ ] **Step 3: Create `brands/jakite/brand.json`**

```json
{
  "name": "Jakite Agent",
  "appId": "com.jakite.agent",
  "serverUrl": "https://jakite.tech",
  "primaryColor": "#6c63ff",
  "productName": "Jakite Agent"
}
```

- [ ] **Step 4: Create `src/electron/brand.ts`**

```typescript
import { readFileSync } from 'fs'
import { join } from 'path'

export interface BrandConfig {
  name: string
  appId: string
  serverUrl: string
  primaryColor: string
  productName: string
}

export function loadBrandConfig(): BrandConfig {
  const brand = process.env.BUILD_BRAND
  if (!brand) throw new Error('BUILD_BRAND environment variable is required')
  const brandPath = join(process.cwd(), 'brands', brand, 'brand.json')
  return JSON.parse(readFileSync(brandPath, 'utf-8')) as BrandConfig
}
```

- [ ] **Step 5: Create placeholder icon files**

```bash
mkdir -p brands/jakite/icons
# Create empty placeholder files — real icons to be provided as:
# icon.png: 512×512 PNG
# icon.ico: Windows multi-resolution ICO
# icon.icns: macOS multi-resolution ICNS
touch brands/jakite/icons/icon.png
touch brands/jakite/icons/icon.ico
touch brands/jakite/icons/icon.icns
```

> ⚠️ **electron-builder will fail with these empty placeholders.** The `electron:pack:*` scripts cannot run until real icon files are placed here. `electron:dev` (which only compiles + launches Electron without electron-builder) will work with empty icons. Replace placeholders with real assets before running any `electron:pack:*` command.

Add a README note in `brands/jakite/icons/README.md`:
```
Real icon files required before packaging:
- icon.png: 512×512 RGBA PNG (Linux + generic)
- icon.ico: Windows multi-resolution (16,32,48,64,128,256px)
- icon.icns: macOS multi-resolution ICNS (generate from icon.png using iconutil on macOS)
```

- [ ] **Step 6: Run test to verify it passes**

```bash
BUILD_BRAND=jakite npm test -- tests/electron/brand.test.ts
```

Expected: PASS — 2 tests passing.

- [ ] **Step 7: Commit**

```bash
git add brands/ src/electron/brand.ts tests/electron/brand.test.ts
git commit -m "feat: add brand system with jakite config and icon placeholders"
```

---

### Task 2.2: Electron + electron-builder project setup

**Files:**
- Modify: `package.json`
- Create: `electron-builder.config.js`
- Create: `tsconfig.electron.json`
- Create: `resources/agent-setup.example.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install Electron and electron-builder**

```bash
npm install --save-dev electron@latest electron-builder@latest
```

Expected: Installs without errors. `node_modules/electron/` exists.

- [ ] **Step 2: Create `tsconfig.electron.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist/electron",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/electron/**/*", "src/core/**/*", "src/cli/**/*"],
  "exclude": ["node_modules", "tests/**"]
}
```

Note: `module: "CommonJS"` is required — Electron main process does not support ESM natively.

- [ ] **Step 3: Create `electron-builder.config.js`**

```javascript
const brand = process.env.BUILD_BRAND || 'jakite'
const brandConfig = require(`./brands/${brand}/brand.json`)

module.exports = {
  appId: brandConfig.appId,
  productName: brandConfig.productName,
  directories: {
    output: `releases/${brand}`,
    buildResources: `brands/${brand}/icons`
  },
  files: [
    'dist/electron/**/*',
    'node_modules/**/*',
    '!node_modules/.cache/**/*'
  ],
  extraResources: [
    {
      from: `brands/${brand}/icons`,
      to: 'icons'
    }
  ],
  win: {
    target: 'nsis',
    icon: `brands/${brand}/icons/icon.ico`
  },
  mac: {
    target: 'dmg',
    icon: `brands/${brand}/icons/icon.icns`
  },
  linux: {
    target: ['AppImage', 'deb'],
    icon: `brands/${brand}/icons/icon.png`
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: false
  }
}
```

- [ ] **Step 4: Add scripts to `package.json`**

Add to `"scripts"`:

```json
"electron:compile": "tsc -p tsconfig.electron.json",
"electron:bundle:installer": "esbuild src/electron/installer/installer.ts --bundle --outfile=dist/electron/installer/installer.js --platform=browser --target=chrome120",
"electron:bundle:app": "esbuild src/electron/app/app.ts --bundle --outfile=dist/electron/app/app.js --platform=browser --target=chrome120",
"electron:copy-html": "cp src/electron/installer/installer.html dist/electron/installer/installer.html && cp src/electron/app/app.html dist/electron/app/app.html",
"electron:build": "BUILD_BRAND=jakite npm run electron:compile && npm run electron:bundle:installer && npm run electron:bundle:app && npm run electron:copy-html",
"electron:dev": "npm run electron:build && BUILD_BRAND=jakite npx electron dist/electron/main.js",
"electron:pack:win": "npm run electron:build && BUILD_BRAND=jakite npx electron-builder --win",
"electron:pack:mac": "npm run electron:build && BUILD_BRAND=jakite npx electron-builder --mac",
"electron:pack:linux": "npm run electron:build && BUILD_BRAND=jakite npx electron-builder --linux"
```

- [ ] **Step 5: Create `resources/agent-setup.example.json`**

```json
{
  "_comment": "This file is generated by jakite.tech download endpoint with the user's token. Rename to agent-setup.json for testing.",
  "token": "your-api-token-here",
  "serverUrl": "https://jakite.tech"
}
```

- [ ] **Step 6: Update `.gitignore`**

Add:
```
dist/electron/
releases/jakite/
releases/aibl/
.superpowers/
resources/agent-setup.json
```

- [ ] **Step 7: Verify TypeScript compiles `src/electron/brand.ts` without errors**

By this step `src/electron/brand.ts` already exists (created in Task 2.1). Run:

```bash
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: Zero TypeScript errors. `brand.ts` is the only electron file at this point so the result is deterministic.

- [ ] **Step 8: Commit**

```bash
git add package.json electron-builder.config.js tsconfig.electron.json resources/ .gitignore
git commit -m "chore: add electron and electron-builder project setup with brand-aware build"
```

---

## Chunk 3: Electron Core — IPC Types, Activity Logic, Preload, Main Process

### Task 3.1: IPC type definitions and activity calculator

**Files:**
- Create: `src/electron/ipc-types.ts`
- Create: `src/electron/activity.ts`
- Create: `tests/electron/activity.test.ts`

- [ ] **Step 1: Create `src/electron/ipc-types.ts`**

```typescript
export interface AgentStatus {
  version: string
  latestVersion: string | null
  apiKeyMasked: string
  apiKeyFull: string
  lastSentAt: string | null
  nextSendEstimate: string | null
  activities: ActivityItem[]
}

export interface ActivityItem {
  tool: string
  label: string
  level: 'high' | 'normal' | 'low' | 'none'
  percentage: number
}

export interface InstallerSetup {
  token: string
  serverUrl: string
}
```

- [ ] **Step 2: Write failing test for activity calculator**

Create `tests/electron/activity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calculateActivityLevel } from '../../src/electron/activity.js'
import type { SendHistoryEntry } from '../../src/core/config.js'

describe('calculateActivityLevel', () => {
  it('returns none for 0 sessions', () => {
    const result = calculateActivityLevel(0, [])
    expect(result.level).toBe('none')
    expect(result.percentage).toBe(0)
  })

  describe('fixed thresholds (no history)', () => {
    it('returns low for < 3 sessions', () => {
      expect(calculateActivityLevel(2, []).level).toBe('low')
    })

    it('returns normal for 3–10 sessions', () => {
      expect(calculateActivityLevel(3, []).level).toBe('normal')
      expect(calculateActivityLevel(10, []).level).toBe('normal')
    })

    it('returns high for > 10 sessions', () => {
      expect(calculateActivityLevel(11, []).level).toBe('high')
    })
  })

  describe('personal baseline (with history)', () => {
    const history: SendHistoryEntry[] = [
      { sentAt: '2026-03-10T00:00:00Z', sessions: { 'claude-code': 10 } },
      { sentAt: '2026-03-09T00:00:00Z', sessions: { 'claude-code': 10 } },
    ]

    it('returns low when current is < 50% of avg', () => {
      // avg = 10, current = 4 (40%) → low
      expect(calculateActivityLevel(4, history, 'claude-code').level).toBe('low')
    })

    it('returns normal when current is 50–150% of avg', () => {
      // avg = 10, current = 10 (100%) → normal
      expect(calculateActivityLevel(10, history, 'claude-code').level).toBe('normal')
    })

    it('returns high when current is > 150% of avg', () => {
      // avg = 10, current = 16 (160%) → high
      expect(calculateActivityLevel(16, history, 'claude-code').level).toBe('high')
    })

    it('percentage is capped at 100', () => {
      expect(calculateActivityLevel(100, history, 'claude-code').percentage).toBeLessThanOrEqual(100)
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/electron/activity.test.ts
```

Expected: FAIL — `Cannot find module '../../src/electron/activity.js'`

- [ ] **Step 4: Create `src/electron/activity.ts`**

```typescript
import type { SendHistoryEntry } from '../core/config.js'

export interface ActivityLevel {
  level: 'high' | 'normal' | 'low' | 'none'
  percentage: number
}

export function calculateActivityLevel(
  currentSessions: number,
  history: SendHistoryEntry[],
  tool?: string
): ActivityLevel {
  if (currentSessions === 0) return { level: 'none', percentage: 0 }

  const relevant = tool
    ? history.filter(h => h.sessions[tool] !== undefined)
    : history

  if (relevant.length === 0) {
    // Fixed thresholds: <3 low, 3-10 normal, >10 high
    if (currentSessions < 3) return { level: 'low', percentage: Math.round((currentSessions / 3) * 50) }
    if (currentSessions <= 10) return { level: 'normal', percentage: Math.round(50 + ((currentSessions - 3) / 7) * 50) }
    return { level: 'high', percentage: 100 }
  }

  const avg = relevant.reduce((sum, h) => {
    const val = tool ? (h.sessions[tool] ?? 0) : Object.values(h.sessions).reduce((a, b) => a + b, 0)
    return sum + val
  }, 0) / relevant.length

  if (avg === 0) return { level: 'none', percentage: 0 }

  const ratio = currentSessions / avg
  const percentage = Math.min(100, Math.round(ratio * 100))

  if (ratio < 0.5) return { level: 'low', percentage }
  if (ratio <= 1.5) return { level: 'normal', percentage }
  return { level: 'high', percentage }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/electron/activity.test.ts
```

Expected: PASS — 8 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/electron/ipc-types.ts src/electron/activity.ts tests/electron/activity.test.ts
git commit -m "feat(electron): add IPC types and activity level calculator with tests"
```

---

### Task 3.2: Preload script

**Files:**
- Create: `src/electron/preload.ts`

- [ ] **Step 1: Create `src/electron/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Installer
  getInstallerSetup: () =>
    ipcRenderer.invoke('installer:get-setup'),
  validateToken: (token: string, serverUrl: string) =>
    ipcRenderer.invoke('installer:validate-token', token, serverUrl),
  saveConfig: (token: string, serverUrl: string) =>
    ipcRenderer.invoke('installer:save-config', token, serverUrl),
  installService: () =>
    ipcRenderer.invoke('installer:install-service'),
  registerSetup: (collectors: string[]) =>
    ipcRenderer.invoke('installer:register-setup', collectors),
  runFirstCollection: () =>
    ipcRenderer.invoke('installer:run-first-collection'),
  createShortcut: () =>
    ipcRenderer.invoke('installer:create-shortcut'),
  finishInstall: () =>
    ipcRenderer.invoke('installer:finish'),

  // Shared
  getAppVersion: () =>
    ipcRenderer.invoke('app:get-version'),

  // App window
  getStatus: () =>
    ipcRenderer.invoke('app:get-status'),
  revealApiKey: () =>
    ipcRenderer.invoke('app:reveal-apikey'),
  uninstall: () =>
    ipcRenderer.invoke('app:uninstall'),
  closeWindow: () =>
    ipcRenderer.invoke('app:close-window'),
  openDownloadPage: () =>
    ipcRenderer.invoke('app:open-download'),
})
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: No errors for preload.ts (electron types may need `@types/electron` — electron package includes its own types, verify with `ls node_modules/electron/*.d.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/electron/preload.ts
git commit -m "feat(electron): add preload context bridge"
```

---

### Task 3.3: Main process

**Files:**
- Create: `src/electron/main.ts`

- [ ] **Step 1: Create `src/electron/main.ts`**

```typescript
import { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { loadBrandConfig } from './brand.js'
import { configExists, loadConfig, saveConfig } from '../core/config.js'
import { serviceInstall, serviceUninstall } from '../core/service.js'
import { calculateActivityLevel } from './activity.js'
import type { AgentStatus, InstallerSetup } from './ipc-types.js'

const brand = loadBrandConfig()
const AGENT_VERSION = app.getVersion()

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let installerWindow: BrowserWindow | null = null

// ── Helpers ──────────────────────────────────────────────────

function getIconPath(): string {
  const iconsDir = existsSync(join(process.resourcesPath ?? '', 'icons'))
    ? join(process.resourcesPath, 'icons')
    : join(__dirname, '../../brands', process.env.BUILD_BRAND ?? 'jakite', 'icons')
  return join(iconsDir, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
}

function readInstallerSetup(): InstallerSetup | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'agent-setup.json'),
    join(__dirname, '../../resources/agent-setup.json'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8')) as InstallerSetup
  }
  return null
}

// ── Window factories ─────────────────────────────────────────

function createTray() {
  const iconPath = getIconPath()
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip(brand.name)
  tray.on('click', () => mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show())
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Cerrar aplicación', role: 'quit' },
  ]))
}

function createInstallerWindow() {
  installerWindow = new BrowserWindow({
    width: 560,
    height: 540,
    resizable: false,
    title: brand.name,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  installerWindow.setMenuBarVisibility(false)
  installerWindow.loadFile(join(__dirname, 'installer/installer.html'))
  installerWindow.on('closed', () => { installerWindow = null })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 580,
    resizable: false,
    title: brand.name,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadFile(join(__dirname, 'app/app.html'))
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

// ── IPC: Installer ───────────────────────────────────────────

ipcMain.handle('installer:get-setup', () => readInstallerSetup())

ipcMain.handle('installer:validate-token', async (_, token: string, serverUrl: string) => {
  try {
    const res = await fetch(`${serverUrl}/api/agent/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentVersion: AGENT_VERSION }),
    })
    const data = await res.json() as { latestVersion?: string }
    return { ok: res.ok, latestVersion: data.latestVersion ?? null }
  } catch {
    return { ok: false, latestVersion: null }
  }
})

ipcMain.handle('installer:save-config', async (_, token: string, serverUrl: string) => {
  const config = {
    serverUrl,
    authToken: token,
    syncIntervalHours: 15,
    enabledCollectors: [] as string[],
    sendHistory: [],
    consentGivenAt: new Date().toISOString(),
  }
  await saveConfig(config)
  return { ok: true }
})

ipcMain.handle('installer:install-service', async () => {
  try {
    await serviceInstall()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('installer:register-setup', async (_, collectors: string[]) => {
  try {
    const config = await loadConfig()
    const res = await fetch(`${config.serverUrl}/api/agent/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: config.authToken,
        enabledCollectors: collectors,
        agentVersion: AGENT_VERSION,
        platform: process.platform,
      }),
    })
    const data = await res.json() as { ok: boolean; syncIntervalHours?: number; encryptionKey?: string }
    if (data.ok) {
      config.enabledCollectors = collectors
      if (data.syncIntervalHours) config.syncIntervalHours = data.syncIntervalHours
      if (data.encryptionKey) config.encryptionKey = data.encryptionKey
      await saveConfig(config)
    }
    return { ok: data.ok }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('installer:run-first-collection', async () => {
  try {
    const config = await loadConfig()
    const { collectAll } = await import('../core/collector-runner.js')
    await collectAll(config)
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('installer:create-shortcut', () => {
  if (process.platform === 'win32') {
    const { homedir } = require('os') as typeof import('os')
    shell.writeShortcutLink(
      join(homedir(), 'Desktop', `${brand.name}.lnk`),
      'create',
      { target: process.execPath }
    )
  }
  // macOS/Linux: shortcut creation handled by electron-builder
  return { ok: true }
})

ipcMain.handle('installer:finish', () => {
  installerWindow?.destroy()
  installerWindow = null
  createMainWindow()
  mainWindow?.show()
})

// ── IPC: App window ──────────────────────────────────────────

ipcMain.handle('app:get-status', async (): Promise<AgentStatus> => {
  const config = await loadConfig()
  const { sendHistory = [], enabledCollectors = [], lastSentAt, authToken, latestAgentVersion, syncIntervalHours } = config

  const activities = enabledCollectors.map(tool => {
    const toolSessions = sendHistory.length > 0
      ? sendHistory[sendHistory.length - 1]?.sessions[tool] ?? 0
      : 0
    const history = sendHistory.slice(0, -1)
    const activity = calculateActivityLevel(toolSessions, history, tool)
    const labels: Record<string, string> = {
      'claude-code': 'Claude Code',
      'cursor': 'Cursor',
      'vscode-copilot': 'Copilot',
    }
    return { tool, label: labels[tool] ?? tool, ...activity }
  })

  const nextSend = lastSentAt
    ? new Date(new Date(lastSentAt).getTime() + syncIntervalHours * 3_600_000).toISOString()
    : null

  return {
    version: AGENT_VERSION,
    latestVersion: latestAgentVersion ?? null,
    apiKeyMasked: authToken ? `${authToken.slice(0, 4)}••••••••${authToken.slice(-4)}` : '••••••••',
    apiKeyFull: authToken,
    lastSentAt: lastSentAt ?? null,
    nextSendEstimate: nextSend,
    activities,
  }
})

ipcMain.handle('app:reveal-apikey', async () => {
  const config = await loadConfig()
  return config.authToken
})

ipcMain.handle('app:uninstall', async () => {
  try {
    await serviceUninstall()
    const { unlinkSync } = require('fs') as typeof import('fs')
    const { getConfigDir } = await import('../core/config.js')
    try { unlinkSync(join(getConfigDir(), 'config.json')) } catch {}
    app.quit()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('app:close-window', () => mainWindow?.hide())

ipcMain.handle('app:open-download', () => shell.openExternal(`${brand.serverUrl}/download`))

ipcMain.handle('app:get-version', () => app.getVersion())

// ── App lifecycle ────────────────────────────────────────────

app.whenReady().then(() => {
  app.setAppUserModelId(brand.appId)
  createTray()
  if (configExists()) {
    createMainWindow()
  } else {
    createInstallerWindow()
  }
})

app.on('window-all-closed', (e: Event) => e.preventDefault())

app.on('activate', () => mainWindow?.show())
```

- [ ] **Step 2: Identify collector function export names**

```bash
grep -n "^export" src/core/collectors/claude-code.ts
grep -n "^export" src/core/collectors/cursor.ts
grep -n "^export" src/core/collectors/vscode-copilot.ts
```

Note the exact exported function names. Use them in the next step.

- [ ] **Step 3: Create `src/core/collector-runner.ts`**

Replace `<fn>` placeholders with the actual names found in Step 2:

```typescript
// src/core/collector-runner.ts
import { <fn> as collectClaudeCode } from './collectors/claude-code.js'
import { <fn> as collectCursor } from './collectors/cursor.js'
import { <fn> as collectVSCodeCopilot } from './collectors/vscode-copilot.js'
import type { AgentConfig } from './config.js'
import type { CollectorResult } from './types.js'

const COLLECTORS: Record<string, () => Promise<CollectorResult>> = {
  'claude-code': collectClaudeCode,
  'cursor': collectCursor,
  'vscode-copilot': collectVSCodeCopilot,
}

export async function collectAll(config: AgentConfig): Promise<CollectorResult[]> {
  const results: CollectorResult[] = []
  for (const tool of config.enabledCollectors ?? []) {
    const collector = COLLECTORS[tool]
    if (collector) {
      try {
        results.push(await collector())
      } catch {
        // non-fatal — skip failed collector
      }
    }
  }
  return results
}
```

- [ ] **Step 4: Update `src/cli/index.ts` to use `collectAll` from `collector-runner`**

Read the `runCollectors` function in `src/cli/index.ts`. Replace it with an import and delegation to `collectAll` from `'../core/collector-runner.js'` to avoid duplication. The existing call sites in `runOnce()` remain unchanged.

- [ ] **Step 5: Compile to verify no TypeScript errors**

```bash
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: Zero errors. Fix any type errors before continuing.

- [ ] **Step 6: Commit collector-runner**

```bash
git add src/core/collector-runner.ts src/cli/index.ts
git commit -m "feat(core): extract collectAll into collector-runner module"
```

- [ ] **Step 7: Commit main process**

```bash
git add src/electron/main.ts
git commit -m "feat(electron): add main process with tray, IPC handlers, and window management"
```

---

## Chunk 4: Installer Wizard (5 Screens)

### Task 4.1: Installer HTML + renderer logic

**Files:**
- Create: `src/electron/installer/installer.html`
- Create: `src/electron/installer/installer.ts`

- [ ] **Step 1: Create `src/electron/installer/installer.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">
  <title>Instalación</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; color: #1a1a1a;
      height: 100vh; display: flex; flex-direction: column; overflow: hidden;
    }

    /* Screens */
    .screen { display: none; flex-direction: column; flex: 1; padding: 28px 32px; overflow: hidden; }
    .screen.active { display: flex; }

    /* Heading */
    .screen-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
    .screen-subtitle { font-size: 13px; color: #777; margin-bottom: 16px; }

    /* Welcome */
    .welcome-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .welcome-logo .app-icon { width: 48px; height: 48px; background: linear-gradient(135deg, #6c63ff, #3ecfcf); border-radius: 10px; }
    .welcome-logo h1 { font-size: 22px; font-weight: 700; }
    .welcome-desc { font-size: 14px; color: #555; line-height: 1.7; }
    .welcome-version { font-size: 12px; color: #aaa; margin-top: 12px; }

    /* Privacy */
    .privacy-scroll {
      flex: 1; overflow-y: auto; background: #fff; border: 1px solid #ddd;
      border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.7; color: #444;
    }
    .privacy-scroll h3 { font-size: 13px; font-weight: 700; margin: 12px 0 4px; color: #222; }
    .privacy-scroll p { margin-bottom: 8px; }
    .consent-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; cursor: pointer; }
    .consent-row input { accent-color: #6c63ff; width: 16px; height: 16px; }

    /* Tech selection */
    .tech-option {
      display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px;
      background: #fff; border: 2px solid #e0e0e0; border-radius: 8px; margin-bottom: 10px; cursor: pointer;
      transition: border-color 0.15s;
    }
    .tech-option:hover { border-color: #6c63ff; }
    .tech-option.selected { border-color: #6c63ff; background: #f8f7ff; }
    .tech-option input[type=checkbox] { accent-color: #6c63ff; width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; }
    .tech-info h3 { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
    .tech-info p { font-size: 12px; color: #888; }

    /* Progress steps */
    .step-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .step-item {
      display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px;
      background: #fff; border: 1px solid #eee; border-radius: 8px; font-size: 13px;
    }
    .step-icon {
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600;
    }
    .step-icon.pending  { background: #f0f0f0; color: #999; }
    .step-icon.running  { background: #fff3cd; color: #856404; }
    .step-icon.done     { background: #d1fae5; color: #065f46; }
    .step-icon.error    { background: #fee2e2; color: #991b1b; }
    .step-content { flex: 1; }
    .step-label { font-weight: 500; }
    .step-error { font-size: 12px; color: #dc2626; margin-top: 3px; }

    /* Done */
    .done-icon { font-size: 56px; text-align: center; margin: 16px 0 12px; }
    .done-title { font-size: 20px; font-weight: 700; text-align: center; margin-bottom: 8px; }
    .done-desc { font-size: 14px; color: #666; text-align: center; line-height: 1.6; }
    .shortcut-row { display: flex; align-items: center; gap: 8px; margin-top: 20px; font-size: 14px; cursor: pointer; }
    .shortcut-row input { accent-color: #6c63ff; width: 16px; height: 16px; }

    /* Footer */
    .footer {
      display: flex; align-items: center; justify-content: flex-end; gap: 10px;
      padding: 14px 32px; background: #fff; border-top: 1px solid #e5e5e5; flex-shrink: 0;
    }
    .btn { padding: 9px 22px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; }
    .btn-primary { background: #6c63ff; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #5b52ee; }
    .btn-primary:disabled { background: #c7c3f7; cursor: not-allowed; }
    .btn-secondary { background: #fff; color: #555; border: 1px solid #ddd; }
    .btn-secondary:hover { background: #f5f5f5; }
  </style>
</head>
<body>

  <!-- Screen 1: Welcome -->
  <div class="screen active" id="screen-welcome">
    <div class="welcome-logo">
      <div class="app-icon" id="brand-icon"></div>
      <h1 id="brand-name">Jakite Agent</h1>
    </div>
    <p class="welcome-desc">
      Este asistente te guiará en el proceso de instalación del agente de escritorio.
      El agente monitoriza tu uso de herramientas de IA y envía métricas anónimas a tu cuenta.
    </p>
    <p class="welcome-version">Versión <span id="agent-version">—</span></p>
  </div>

  <!-- Screen 2: Privacy Policy -->
  <div class="screen" id="screen-privacy">
    <p class="screen-title">Política de privacidad</p>
    <div class="privacy-scroll" id="privacy-scroll">
      <h3>¿Qué datos recopilamos?</h3>
      <p>El agente recopila métricas de uso de herramientas de IA instaladas en tu equipo: número de sesiones, tokens consumidos, modelos utilizados, tipos de tareas y tiempo de uso.</p>
      <h3>¿Qué NO recopilamos?</h3>
      <p>No accedemos al contenido de tus conversaciones, código fuente, rutas de archivos ni ningún dato personal más allá de las métricas de uso.</p>
      <h3>Cifrado</h3>
      <p>Los resúmenes de sesión se cifran localmente con AES-256-GCM antes de ser transmitidos. La clave de cifrado es única para tu instalación y nunca se comparte con terceros.</p>
      <h3>Retención de datos</h3>
      <p>Los datos se almacenan en los servidores de <span class="brand-name-inline">Jakite</span> y se utilizan exclusivamente para generar informes de productividad en tu cuenta personal.</p>
      <h3>Derechos del usuario</h3>
      <p>Puedes desinstalar el agente en cualquier momento desde la ventana principal. Al desinstalar, se detendrá completamente la recopilación de datos.</p>
      <br><br>
    </div>
    <label class="consent-row">
      <input type="checkbox" id="consent-check" disabled>
      <span>He leído y acepto la política de privacidad</span>
    </label>
  </div>

  <!-- Screen 3: Technology Selection -->
  <div class="screen" id="screen-tech">
    <p class="screen-title">Selecciona las tecnologías</p>
    <p class="screen-subtitle">Elige al menos una herramienta a monitorizar:</p>
    <label class="tech-option selected" id="opt-claude">
      <input type="checkbox" name="tech" value="claude-code" checked>
      <div class="tech-info">
        <h3>Claude Code</h3>
        <p>Sesiones, tokens consumidos, modelos usados, tipos de tarea detectados</p>
      </div>
    </label>
    <label class="tech-option" id="opt-cursor">
      <input type="checkbox" name="tech" value="cursor">
      <div class="tech-info">
        <h3>Cursor</h3>
        <p>Sesiones de chat IA, modelos utilizados, actividad del asistente</p>
      </div>
    </label>
    <label class="tech-option" id="opt-copilot">
      <input type="checkbox" name="tech" value="vscode-copilot">
      <div class="tech-info">
        <h3>GitHub Copilot</h3>
        <p>Detección de instalación y extensiones IA activas en VS Code</p>
      </div>
    </label>
  </div>

  <!-- Screen 4: Installing -->
  <div class="screen" id="screen-installing">
    <p class="screen-title">Instalando...</p>
    <ul class="step-list">
      <li class="step-item">
        <div class="step-icon pending" id="icon-validate">1</div>
        <div class="step-content">
          <div class="step-label">Validando token con el servidor</div>
          <div class="step-error" id="error-validate"></div>
        </div>
      </li>
      <li class="step-item">
        <div class="step-icon pending" id="icon-config">2</div>
        <div class="step-content">
          <div class="step-label">Guardando configuración</div>
          <div class="step-error" id="error-config"></div>
        </div>
      </li>
      <li class="step-item">
        <div class="step-icon pending" id="icon-service">3</div>
        <div class="step-content">
          <div class="step-label">Instalando servicio del sistema</div>
          <div class="step-error" id="error-service"></div>
        </div>
      </li>
      <li class="step-item">
        <div class="step-icon pending" id="icon-register">4</div>
        <div class="step-content">
          <div class="step-label">Registrando tecnologías en el servidor</div>
          <div class="step-error" id="error-register"></div>
        </div>
      </li>
      <li class="step-item">
        <div class="step-icon pending" id="icon-collect">5</div>
        <div class="step-content">
          <div class="step-label">Primera captura de datos</div>
          <div class="step-error" id="error-collect"></div>
        </div>
      </li>
    </ul>
  </div>

  <!-- Screen 5: Done -->
  <div class="screen" id="screen-done">
    <div class="done-icon">✅</div>
    <div class="done-title">¡Instalación completada!</div>
    <p class="done-desc">El agente está activo y enviará métricas automáticamente según el intervalo configurado.</p>
    <label class="shortcut-row">
      <input type="checkbox" id="shortcut-check" checked>
      <span>Crear acceso directo en el escritorio</span>
    </label>
  </div>

  <!-- Footer -->
  <div class="footer">
    <button class="btn btn-secondary" id="btn-back" style="display:none">Atrás</button>
    <button class="btn btn-primary" id="btn-next">Siguiente</button>
  </div>

  <script src="installer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/electron/installer/installer.ts`**

```typescript
type ElectronAPI = {
  getInstallerSetup: () => Promise<{ token: string; serverUrl: string } | null>
  validateToken: (token: string, serverUrl: string) => Promise<{ ok: boolean; latestVersion: string | null }>
  saveConfig: (token: string, serverUrl: string) => Promise<{ ok: boolean }>
  installService: () => Promise<{ ok: boolean; error?: string }>
  registerSetup: (collectors: string[]) => Promise<{ ok: boolean; error?: string }>
  runFirstCollection: () => Promise<{ ok: boolean }>
  createShortcut: () => Promise<{ ok: boolean }>
  finishInstall: () => Promise<void>
}

declare const window: Window & { electronAPI: ElectronAPI }

const SCREENS = ['welcome', 'privacy', 'tech', 'installing', 'done'] as const
type Screen = typeof SCREENS[number]

let currentScreen: Screen = 'welcome'
let setup: { token: string; serverUrl: string } | null = null
let selectedCollectors: string[] = []

// ── Screen management ──────────────────────────────────────

function showScreen(name: Screen) {
  document.querySelectorAll<HTMLElement>('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(`screen-${name}`)?.classList.add('active')
  currentScreen = name

  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  const btnBack = document.getElementById('btn-back') as HTMLButtonElement

  const hideBack = name === 'welcome' || name === 'installing' || name === 'done'
  const hideNext = name === 'installing'

  btnBack.style.display = hideBack ? 'none' : 'inline-block'
  btnNext.style.display = hideNext ? 'none' : 'inline-block'
  btnNext.textContent = name === 'done' ? 'Finalizar' : 'Siguiente'

  if (name === 'privacy') {
    const consent = document.getElementById('consent-check') as HTMLInputElement
    btnNext.disabled = !consent.checked
  } else if (name === 'tech') {
    updateTechNextButton()
  } else {
    btnNext.disabled = false
  }
}

// ── Step status ────────────────────────────────────────────

function setStep(step: string, status: 'pending' | 'running' | 'done' | 'error', errorMsg?: string) {
  const icon = document.getElementById(`icon-${step}`)
  const error = document.getElementById(`error-${step}`)
  if (!icon) return
  icon.className = `step-icon ${status}`
  const stepNum = icon.textContent?.match(/\d/)?.[0] ?? ''
  icon.textContent = status === 'done' ? '✓' : status === 'error' ? '✗' : status === 'running' ? '⟳' : stepNum
  if (error) error.textContent = errorMsg ?? ''
}

// ── Installation flow ──────────────────────────────────────

async function runInstallation() {
  showScreen('installing')
  if (!setup) return

  // Step 1: Validate token
  setStep('validate', 'running')
  const validation = await window.electronAPI.validateToken(setup.token, setup.serverUrl)
  if (!validation.ok) {
    setStep('validate', 'error', 'Token inválido o servidor no disponible')
    showRetry()
    return
  }
  setStep('validate', 'done')

  // Step 2: Save config
  setStep('config', 'running')
  const saved = await window.electronAPI.saveConfig(setup.token, setup.serverUrl)
  if (!saved.ok) {
    setStep('config', 'error', 'No se pudo guardar la configuración')
    return
  }
  setStep('config', 'done')

  // Step 3: Install service
  setStep('service', 'running')
  const service = await window.electronAPI.installService()
  if (!service.ok) {
    setStep('service', 'error', service.error ?? 'Error al instalar el servicio')
    // Non-fatal: continue anyway
  } else {
    setStep('service', 'done')
  }

  // Step 4: Register technologies
  setStep('register', 'running')
  const registered = await window.electronAPI.registerSetup(selectedCollectors)
  if (!registered.ok) {
    setStep('register', 'error', registered.error ?? 'Error al registrar tecnologías')
  } else {
    setStep('register', 'done')
  }

  // Step 5: First collection
  setStep('collect', 'running')
  const collected = await window.electronAPI.runFirstCollection()
  if (!collected.ok) {
    setStep('collect', 'error', 'La captura inicial no pudo completarse (se reintentará automáticamente)')
  } else {
    setStep('collect', 'done')
  }

  showScreen('done')
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  btnNext.style.display = 'inline-block'
}

function showRetry() {
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  btnNext.style.display = 'inline-block'
  btnNext.textContent = 'Reintentar'
  btnNext.disabled = false
  btnNext.onclick = () => runInstallation()
}

// ── Tech option visual selection ───────────────────────────

function updateTechNextButton() {
  const checked = document.querySelectorAll<HTMLInputElement>('input[name=tech]:checked')
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  if (currentScreen === 'tech') btnNext.disabled = checked.length === 0
}

document.querySelectorAll<HTMLElement>('.tech-option').forEach(opt => {
  opt.addEventListener('change', () => {
    const cb = opt.querySelector<HTMLInputElement>('input[type=checkbox]')
    opt.classList.toggle('selected', cb?.checked ?? false)
    updateTechNextButton()
  })
})

// ── Privacy scroll: enable consent when scrolled to bottom ─

document.getElementById('privacy-scroll')?.addEventListener('scroll', function () {
  const el = this as HTMLElement
  const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 20
  const checkbox = document.getElementById('consent-check') as HTMLInputElement
  if (atBottom && checkbox.disabled) {
    checkbox.disabled = false
  }
})

document.getElementById('consent-check')?.addEventListener('change', function () {
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  if (currentScreen === 'privacy') btnNext.disabled = !(this as HTMLInputElement).checked
})

// ── Navigation ─────────────────────────────────────────────

document.getElementById('btn-next')?.addEventListener('click', async () => {
  const idx = SCREENS.indexOf(currentScreen)

  if (currentScreen === 'tech') {
    selectedCollectors = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name=tech]:checked')
    ).map(c => c.value)
    await runInstallation()
    return
  }

  if (currentScreen === 'done') {
    const wantShortcut = (document.getElementById('shortcut-check') as HTMLInputElement).checked
    if (wantShortcut) await window.electronAPI.createShortcut()
    await window.electronAPI.finishInstall()
    return
  }

  if (idx < SCREENS.length - 1) showScreen(SCREENS[idx + 1])
})

document.getElementById('btn-back')?.addEventListener('click', () => {
  const idx = SCREENS.indexOf(currentScreen)
  if (idx > 0) showScreen(SCREENS[idx - 1])
})

// ── Init ───────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  setup = await window.electronAPI.getInstallerSetup()
  const versionEl = document.getElementById('agent-version')
  if (versionEl) {
    const ver = await window.electronAPI.getAppVersion()
    versionEl.textContent = ver
  }
})
```

- [ ] **Step 3: Bundle the installer renderer**

```bash
mkdir -p dist/electron/installer
npx esbuild src/electron/installer/installer.ts --bundle --outfile=dist/electron/installer/installer.js --platform=browser --target=chrome120
```

Expected: `dist/electron/installer/installer.js` created without errors.

- [ ] **Step 4: Copy HTML to dist/**

```bash
mkdir -p dist/electron/installer
cp src/electron/installer/installer.html dist/electron/installer/installer.html
```

- [ ] **Step 5: Commit**

```bash
git add src/electron/installer/
git commit -m "feat(electron): add installer wizard with 5 screens and full setup flow"
```

---

## Chunk 5: Desktop App Window + Final Integration

### Task 5.1: App window HTML + renderer

**Files:**
- Create: `src/electron/app/app.html`
- Create: `src/electron/app/app.ts`

- [ ] **Step 1: Create `src/electron/app/app.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">
  <title>Jakite Agent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e; color: #e0e0e0;
      height: 100vh; display: flex; flex-direction: column; overflow: hidden;
      -webkit-user-select: none; user-select: none;
    }

    /* Titlebar */
    .titlebar {
      background: #12122a; padding: 10px 14px;
      display: flex; align-items: center; gap: 10px; flex-shrink: 0;
      -webkit-app-region: drag;
    }
    .titlebar .app-icon {
      width: 20px; height: 20px; background: linear-gradient(135deg, #6c63ff, #3ecfcf);
      border-radius: 4px; flex-shrink: 0; -webkit-app-region: no-drag;
    }
    .titlebar .title { flex: 1; font-size: 13px; font-weight: 600; color: #c0c0d0; }
    .titlebar .version { font-size: 11px; color: #444; }

    /* Body */
    .body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }

    /* Update banner */
    .update-banner {
      background: rgba(255,193,7,.1); border: 1px solid rgba(255,193,7,.3);
      border-radius: 6px; padding: 8px 12px;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .update-text { font-size: 12px; color: #fbbf24; }
    .btn-update {
      font-size: 11px; background: #fbbf24; color: #000;
      border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-weight: 600; white-space: nowrap;
    }

    /* API Key row */
    .apikey-row {
      background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
      border-radius: 6px; padding: 8px 12px; display: flex; align-items: center; gap: 8px;
    }
    .apikey-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .5px; flex-shrink: 0; }
    .apikey-value { flex: 1; font-size: 12px; color: #999; font-family: 'Courier New', monospace; text-align: center; }
    .btn-show {
      font-size: 11px; background: transparent; color: #6c63ff;
      border: 1px solid #6c63ff; border-radius: 4px; padding: 3px 8px; cursor: pointer; white-space: nowrap;
    }

    /* Section label */
    .section-label { font-size: 10px; font-weight: 700; color: #444; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 6px; }

    /* Last send box */
    .last-send-box {
      background: rgba(108,99,255,.08); border: 1px solid rgba(108,99,255,.2);
      border-radius: 6px; padding: 10px 12px;
    }
    .last-send-date { font-size: 13px; font-weight: 600; color: #ddd; }
    .last-send-meta { font-size: 11px; color: #666; margin-top: 3px; }

    /* Activity bars */
    .activity-item { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .activity-item:last-child { margin-bottom: 0; }
    .activity-name { font-size: 12px; color: #bbb; width: 90px; flex-shrink: 0; }
    .bar-track { flex: 1; height: 7px; background: rgba(255,255,255,.07); border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width .4s ease; }
    .bar-fill.high   { background: linear-gradient(90deg,#6c63ff,#3ecfcf); }
    .bar-fill.normal { background: linear-gradient(90deg,#22c55e,#16a34a); }
    .bar-fill.low    { background: #fbbf24; }
    .bar-fill.none   { background: rgba(255,255,255,.1); }
    .activity-badge { font-size: 10px; font-weight: 700; width: 60px; text-align: right; flex-shrink: 0; }
    .activity-badge.high   { color: #3ecfcf; }
    .activity-badge.normal { color: #22c55e; }
    .activity-badge.low    { color: #fbbf24; }
    .activity-badge.none   { color: #444; }

    .next-send { font-size: 11px; color: #444; text-align: center; }
    .next-send span { color: #666; }

    /* Divider + footer */
    .divider { height: 1px; background: rgba(255,255,255,.06); flex-shrink: 0; }
    .footer { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 12px; flex-shrink: 0; }
    .btn-uninstall {
      font-size: 12px; background: transparent; color: #f87171;
      border: 1px solid rgba(248,113,113,.35); border-radius: 5px; padding: 6px 14px; cursor: pointer;
    }
    .btn-uninstall:hover { background: rgba(248,113,113,.1); }
    .btn-close {
      font-size: 12px; background: rgba(255,255,255,.07); color: #bbb;
      border: 1px solid rgba(255,255,255,.1); border-radius: 5px; padding: 6px 14px; cursor: pointer;
    }
    .btn-close:hover { background: rgba(255,255,255,.12); }
  </style>
</head>
<body>

  <div class="titlebar">
    <div class="app-icon"></div>
    <span class="title" id="brand-title">Jakite Agent</span>
    <span class="version" id="version-label">v—</span>
  </div>

  <div class="body">

    <div class="update-banner" id="update-banner" style="display:none">
      <span class="update-text">⚠ Nueva versión disponible: <strong id="latest-version-text"></strong></span>
      <button class="btn-update" id="btn-update">Descargar</button>
    </div>

    <div class="apikey-row">
      <span class="apikey-label">API Key</span>
      <span class="apikey-value" id="apikey-display">••••••••</span>
      <button class="btn-show" id="btn-show-key">Mostrar</button>
    </div>

    <div>
      <div class="section-label">Último envío</div>
      <div class="last-send-box">
        <div class="last-send-date" id="last-send-date">Sin envíos aún</div>
        <div class="last-send-meta" id="last-send-meta"></div>
      </div>
    </div>

    <div>
      <div class="section-label">Actividad desde el último envío</div>
      <div id="activity-list"></div>
    </div>

    <div class="next-send">Próximo envío estimado: <span id="next-send-label">—</span></div>

  </div>

  <div class="divider"></div>

  <div class="footer">
    <button class="btn-uninstall" id="btn-uninstall">Desinstalar</button>
    <button class="btn-close" id="btn-close">Cerrar ×</button>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/electron/app/app.ts`**

```typescript
import type { AgentStatus } from '../ipc-types.js'

type ElectronAPI = {
  getStatus: () => Promise<AgentStatus>
  revealApiKey: () => Promise<string>
  uninstall: () => Promise<{ ok: boolean }>
  closeWindow: () => Promise<void>
  openDownloadPage: () => Promise<void>
}

declare const window: Window & { electronAPI: ElectronAPI }

const LEVEL_LABELS: Record<string, string> = {
  high: 'Alta',
  normal: 'Normal',
  low: 'Poca',
  none: 'Sin datos',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatNextSend(iso: string | null): string {
  if (!iso) return '—'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'Inminente'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  return h > 0 ? `~${h}h` : `~${m}m`
}

async function loadStatus() {
  const status = await window.electronAPI.getStatus()

  document.getElementById('version-label')!.textContent = `v${status.version}`

  if (status.latestVersion && status.latestVersion !== status.version) {
    const banner = document.getElementById('update-banner')!
    banner.style.display = 'flex'
    document.getElementById('latest-version-text')!.textContent = `v${status.latestVersion}`
  }

  document.getElementById('apikey-display')!.textContent = status.apiKeyMasked

  if (status.lastSentAt) {
    document.getElementById('last-send-date')!.textContent = formatDate(status.lastSentAt)
    const totalSessions = status.activities.reduce((sum, a) => sum + (a.percentage > 0 ? 1 : 0), 0)
    document.getElementById('last-send-meta')!.textContent =
      `${status.activities.length} herramientas monitorizadas`
  }

  const activityList = document.getElementById('activity-list')!
  activityList.innerHTML = ''
  for (const item of status.activities) {
    const barWidth = item.level === 'none' ? 100 : item.percentage
    const div = document.createElement('div')
    div.className = 'activity-item'
    div.innerHTML = `
      <span class="activity-name">${item.label}</span>
      <div class="bar-track">
        <div class="bar-fill ${item.level}" style="width:${barWidth}%"></div>
      </div>
      <span class="activity-badge ${item.level}">${LEVEL_LABELS[item.level] ?? item.level}</span>
    `
    activityList.appendChild(div)
  }

  document.getElementById('next-send-label')!.textContent = formatNextSend(status.nextSendEstimate)
}

// API key toggle
let keyRevealed = false
document.getElementById('btn-show-key')?.addEventListener('click', async () => {
  const display = document.getElementById('apikey-display')!
  const btn = document.getElementById('btn-show-key')!
  if (!keyRevealed) {
    display.textContent = await window.electronAPI.revealApiKey()
    btn.textContent = 'Ocultar'
    keyRevealed = true
  } else {
    const status = await window.electronAPI.getStatus()
    display.textContent = status.apiKeyMasked
    btn.textContent = 'Mostrar'
    keyRevealed = false
  }
})

// Download update
document.getElementById('btn-update')?.addEventListener('click', () => {
  window.electronAPI.openDownloadPage()
})

// Uninstall
document.getElementById('btn-uninstall')?.addEventListener('click', async () => {
  const ok = confirm(
    '¿Estás seguro de que quieres desinstalar el agente?\nSe eliminará el servicio del sistema y la configuración.'
  )
  if (ok) await window.electronAPI.uninstall()
})

// Close window (hides to tray)
document.getElementById('btn-close')?.addEventListener('click', () => {
  window.electronAPI.closeWindow()
})

// Init
window.addEventListener('DOMContentLoaded', loadStatus)
```

- [ ] **Step 3: Bundle the app renderer and copy HTML**

```bash
mkdir -p dist/electron/app
npx esbuild src/electron/app/app.ts --bundle --outfile=dist/electron/app/app.js --platform=browser --target=chrome120
cp src/electron/app/app.html dist/electron/app/app.html
```

Expected: `dist/electron/app/app.js` and `app.html` created.

- [ ] **Step 4: Full build and dev launch test**

```bash
npm run electron:build
BUILD_BRAND=jakite npx electron dist/electron/main.js
```

Expected:
- App launches with tray icon
- If the agent config does NOT exist (Windows: `%USERPROFILE%\.monitor-ia\config.json`, macOS/Linux: `~/.monitor-ia/config.json`): installer wizard opens at screen 1
- If config exists: main window opens
- Tray icon visible in system tray

- [ ] **Step 5: Manual test — installer flow**

Create a test `resources/agent-setup.json` with a valid token:
```json
{ "token": "test-token-123", "serverUrl": "https://jakite.tech" }
```

Walk through all 5 installer screens and verify:
- [ ] Screen 1: Brand name and version visible
- [ ] Screen 2: Next button disabled until scroll bottom + checkbox
- [ ] Screen 3: At least one tech required; visual selection updates
- [ ] Screen 4: Steps execute in sequence with status icons
- [ ] Screen 5: Shortcut checkbox present; Finalizar opens main window

- [ ] **Step 6: Manual test — main window**

With config present, verify:
- [ ] Tray icon visible with tooltip
- [ ] Left-click opens/hides window
- [ ] Right-click shows context menu
- [ ] Version label visible in titlebar
- [ ] API key masked; Mostrar reveals full key
- [ ] Activity bars render for each enabled collector
- [ ] Cerrar hides window (agent stays in tray)
- [ ] Desinstalar shows confirmation dialog

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: All tests pass (core + electron unit tests).

- [ ] **Step 8: Commit**

```bash
git add src/electron/app/ src/electron/main.ts
git commit -m "feat(electron): add main window renderer with activity bars, API key display, and tray"
```

---

### Task 5.2: Package build verification

**Files:**
- No new files — verify `electron:build` and `electron:pack` scripts work end-to-end

- [ ] **Step 1: Add real icon assets**

Replace placeholder files in `brands/jakite/icons/` with real icon files before packaging:
- `icon.png`: 512×512 RGBA PNG
- `icon.ico`: Windows multi-resolution ICO (16, 32, 48, 64, 128, 256px)
- `icon.icns`: macOS ICNS (generated from icon.png using `iconutil` on macOS or `png2icns`)

- [ ] **Step 2: Test packaging on current platform**

On Windows:
```bash
npm run electron:pack:win
```

On macOS:
```bash
npm run electron:pack:mac
```

On Linux:
```bash
npm run electron:pack:linux
```

Expected: `releases/jakite/` contains the installer (`.exe`, `.dmg`, or `.AppImage`).

- [ ] **Step 3: Verify agent-setup.json is read correctly by the packaged app**

After installing the packaged app, find the app's resources directory:
- Windows: `%LOCALAPPDATA%\Programs\Jakite Agent\resources\`
- macOS: `/Applications/Jakite Agent.app/Contents/Resources/`
- Linux: Next to the AppImage or `/opt/jakite-agent/resources/`

Place a test `agent-setup.json` there:
```json
{ "token": "test-token-123", "serverUrl": "https://jakite.tech" }
```

Launch the installed app and verify the installer wizard opens at Screen 1 (not a blank window or error). This confirms `readInstallerSetup()` in `main.ts` correctly resolves `process.resourcesPath`.

Expected: Installer wizard launches and token is available to the setup flow (Step 1 validation will fail with test token, which is expected).

- [ ] **Step 4: Final commit**

```bash
git add brands/jakite/icons/ package.json
git commit -m "feat: add real icon assets and verify electron-builder packaging"
```

---

## Server-side Changes (Separate Project: `monitor_ai`)

These changes are in the `monitor_ai` project (jakite Nuxt monolith) and require a **separate implementation plan**.

| Change | File (monitor_ai) | Details |
|---|---|---|
| `POST /api/agent/setup` | `server/routes/api/agent/setup.post.ts` | Validate token, save enabledCollectors + platform to DB, return syncIntervalHours + encryptionKey |
| `GET /api/download/installer` | `server/routes/api/download/installer.get.ts` | Auth required; embed agent-setup.json in installer download |
| Modify heartbeat | `server/routes/api/agent/heartbeat.post.ts` | Add `latestVersion` field to response |
| DB migration | `prisma/migrations/` | Add installedAt, platform, agentVersion, enabledCollectors to agents/users table |
| User profile UI | `pages/profile.vue` or similar | Show agent status, API key, version, installedAt |

> ⚠️ Create a separate plan for `monitor_ai` before executing these server-side tasks. The DB migration must be tested against the jakite monolith before deploying.

---

## Execution Summary

| Chunk | Tasks | Deliverable |
|---|---|---|
| 1 | Core refactoring + sendHistory | `src/core/`, `src/cli/`, all tests passing |
| 2 | Brand system + Electron setup | `brands/jakite/`, build config, deps installed |
| 3 | Main process + preload + activity | `src/electron/main.ts`, `preload.ts`, `activity.ts`, unit tests |
| 4 | Installer wizard | 5-screen wizard, full install flow |
| 5 | Desktop app window | Tray + window, all features, manual tests pass, packaging works |
| — | Server-side | Separate plan for `monitor_ai` |
