import { readFileSync } from 'fs'
import { join } from 'path'

export interface BrandConfig {
  name: string
  appId: string
  serverUrl: string
  primaryColor: string
  productName: string
}

function resolveBrandPath(brand: string): string {
  // In CommonJS (Electron production/dev build), __dirname points to dist/electron/
  // In production (packaged), extraResources land under process.resourcesPath
  // In development, brands/ is 2 levels up from dist/electron/ (project root)
  // In ESM test context (vitest), __dirname is not defined — fall back to process.cwd()
  let isDev: boolean
  let base: string

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dirnameRef: string | undefined = (typeof __dirname !== 'undefined') ? __dirname : undefined

  if (dirnameRef !== undefined) {
    // CommonJS context (Electron build)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron') as typeof import('electron')
      isDev = !electron.app.isPackaged
    } catch {
      // electron not available (e.g. running outside Electron)
      isDev = true
    }
    base = isDev ? join(dirnameRef, '..', '..') : process.resourcesPath
  } else {
    // ESM / test context: resolve from project root via process.cwd()
    base = process.cwd()
  }

  return join(base, 'brands', brand, 'brand.json')
}

export function loadBrandConfig(): BrandConfig {
  // BUILD_BRAND is set at build time; in production the packaged app is always 'jakite'
  const brand = process.env.BUILD_BRAND ?? 'jakite'

  const brandPath = resolveBrandPath(brand)
  const config = JSON.parse(readFileSync(brandPath, 'utf-8')) as BrandConfig

  // Validate required fields
  const required: (keyof BrandConfig)[] = ['name', 'appId', 'serverUrl', 'primaryColor', 'productName']
  for (const key of required) {
    if (!config[key]) throw new Error(`brand.json for "${brand}" is missing required field: ${key}`)
  }

  // Validate serverUrl is a well-formed URL
  try {
    new URL(config.serverUrl)
  } catch {
    throw new Error(`brand.json for "${brand}" has an invalid serverUrl: "${config.serverUrl}"`)
  }

  return config
}
