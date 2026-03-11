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
