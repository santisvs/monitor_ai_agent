import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('loadBrandConfig', () => {
  const originalBrand = process.env.BUILD_BRAND

  afterEach(() => {
    process.env.BUILD_BRAND = originalBrand
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
