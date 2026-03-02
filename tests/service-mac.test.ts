import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock os BEFORE any module import so the module-level `const platform = os.platform()`
// picks up 'darwin'. vi.mock is hoisted to the top of the file by Vitest.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return {
    default: {
      ...actual,
      platform: () => 'darwin',
      homedir: () => '/tmp/test-home',
    },
  }
})

// Mock fs to prevent real disk operations
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
      readFileSync: vi.fn(() => 'log line'),
    },
  }
})

// Mock child_process so execSync is a spy and never actually runs commands
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    execSync: vi.fn(() => ''),
  }
})

// Mock config module so loadConfig() returns a fake config
vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(() => ({
    serverUrl: 'http://localhost:3000',
    authToken: 'test-token',
    syncIntervalHours: 6,
    enabledCollectors: [],
  })),
}))

describe('service macOS (launchctl bootstrap/bootout)', () => {
  let execSync: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const cp = await import('child_process')
    execSync = cp.execSync as unknown as ReturnType<typeof vi.fn>
  })

  describe('serviceInstall() on darwin', () => {
    it('calls execSync with launchctl bootstrap', async () => {
      const { serviceInstall } = await import('../src/service.js')
      serviceInstall()

      const calls: string[] = execSync.mock.calls
        .map((args: unknown[]) => String(args[0]))

      const hasBootstrap = calls.some(cmd => cmd.includes('launchctl bootstrap'))
      expect(hasBootstrap).toBe(true)
    })

    it('does NOT call execSync with launchctl load', async () => {
      const { serviceInstall } = await import('../src/service.js')
      serviceInstall()

      const calls: string[] = execSync.mock.calls
        .map((args: unknown[]) => String(args[0]))

      const hasLoad = calls.some(cmd => /launchctl load/.test(cmd))
      expect(hasLoad).toBe(false)
    })
  })

  describe('serviceUninstall() on darwin', () => {
    it('calls execSync with launchctl bootout', async () => {
      const { serviceUninstall } = await import('../src/service.js')
      serviceUninstall()

      const calls: string[] = execSync.mock.calls
        .map((args: unknown[]) => String(args[0]))

      const hasBootout = calls.some(cmd => cmd.includes('launchctl bootout'))
      expect(hasBootout).toBe(true)
    })

    it('does NOT call execSync with launchctl unload', async () => {
      const { serviceUninstall } = await import('../src/service.js')
      serviceUninstall()

      const calls: string[] = execSync.mock.calls
        .map((args: unknown[]) => String(args[0]))

      const hasUnload = calls.some(cmd => /launchctl unload/.test(cmd))
      expect(hasUnload).toBe(false)
    })
  })
})
