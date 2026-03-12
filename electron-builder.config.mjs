import { readFileSync } from 'fs'

const brand = process.env.BUILD_BRAND || 'jakite'
const brandConfig = JSON.parse(readFileSync(`./brands/${brand}/brand.json`, 'utf-8'))

export default {
  appId: brandConfig.appId,
  productName: brandConfig.productName,
  artifactName: 'jakite-agent-${os}.${ext}',
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
    oneClick: true,
    perMachine: false
  }
}
