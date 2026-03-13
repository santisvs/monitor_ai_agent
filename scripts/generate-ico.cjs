#!/usr/bin/env node
// Generates a valid Windows ICO from a PNG file (no external tools required)
// Uses pngjs to decode the PNG, then writes a proper ICO with BMP/DIB data
'use strict'

const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const INPUT = path.join(__dirname, '..', 'brands', 'jakite', 'icons', 'icon.png')
const OUTPUT = path.join(__dirname, '..', 'brands', 'jakite', 'icons', 'icon.ico')

const SIZES = [16, 32, 48, 64, 128, 256]

function resizeBilinear(srcData, srcW, srcH, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4)
  const xRatio = srcW / dstW
  const yRatio = srcH / dstH
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio
      const srcY = y * yRatio
      const x0 = Math.floor(srcX), y0 = Math.floor(srcY)
      const x1 = Math.min(x0 + 1, srcW - 1), y1 = Math.min(y0 + 1, srcH - 1)
      const fx = srcX - x0, fy = srcY - y0
      const dstIdx = (y * dstW + x) * 4
      for (let c = 0; c < 4; c++) {
        const tl = srcData[(y0 * srcW + x0) * 4 + c]
        const tr = srcData[(y0 * srcW + x1) * 4 + c]
        const bl = srcData[(y1 * srcW + x0) * 4 + c]
        const br = srcData[(y1 * srcW + x1) * 4 + c]
        dst[dstIdx + c] = Math.round(tl * (1-fx)*(1-fy) + tr * fx*(1-fy) + bl * (1-fx)*fy + br * fx*fy)
      }
    }
  }
  return dst
}

function rgbaToBgra(rgba, w, h) {
  // ICO BMP data is bottom-up and uses BGRA channel order
  const bgra = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4
      const dst = ((h - 1 - y) * w + x) * 4  // flip vertically
      bgra[dst + 0] = rgba[src + 2]  // B
      bgra[dst + 1] = rgba[src + 1]  // G
      bgra[dst + 2] = rgba[src + 0]  // R
      bgra[dst + 3] = rgba[src + 3]  // A
    }
  }
  return bgra
}

function buildBmpEntry(rgbaData, w, h) {
  const pixelData = rgbaToBgra(rgbaData, w, h)
  // AND mask: all zeros (transparency handled by alpha channel)
  const rowBytes = Math.ceil(w / 8 / 4) * 4  // word-aligned
  const andMask = Buffer.alloc(rowBytes * h, 0)

  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)          // biSize
  header.writeInt32LE(w, 4)            // biWidth
  header.writeInt32LE(h * 2, 8)        // biHeight (doubled for ICO)
  header.writeUInt16LE(1, 12)          // biPlanes
  header.writeUInt16LE(32, 14)         // biBitCount
  header.writeUInt32LE(0, 16)          // biCompression (BI_RGB)
  header.writeUInt32LE(pixelData.length, 20) // biSizeImage
  header.writeInt32LE(0, 24)           // biXPelsPerMeter
  header.writeInt32LE(0, 28)           // biYPelsPerMeter
  header.writeUInt32LE(0, 32)          // biClrUsed
  header.writeUInt32LE(0, 36)          // biClrImportant

  return Buffer.concat([header, pixelData, andMask])
}

const pngBuffer = fs.readFileSync(INPUT)
const png = PNG.sync.read(pngBuffer)
const { width: srcW, height: srcH, data: srcData } = png

const images = SIZES.map(size => {
  const rgba = resizeBilinear(srcData, srcW, srcH, size, size)
  return buildBmpEntry(rgba, size, size)
})

// Build ICO
const count = images.length
const headerSize = 6 + count * 16
let offset = headerSize

const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)      // reserved
icoHeader.writeUInt16LE(1, 2)      // type: ICO
icoHeader.writeUInt16LE(count, 4)  // image count

const dirEntries = images.map((img, i) => {
  const size = SIZES[i]
  const entry = Buffer.alloc(16)
  entry.writeUInt8(size === 256 ? 0 : size, 0)   // width (0 = 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1)   // height
  entry.writeUInt8(0, 2)           // color count
  entry.writeUInt8(0, 3)           // reserved
  entry.writeUInt16LE(1, 4)        // planes
  entry.writeUInt16LE(32, 6)       // bit count
  entry.writeUInt32LE(img.length, 8)  // size
  entry.writeUInt32LE(offset, 12)     // offset
  offset += img.length
  return entry
})

const ico = Buffer.concat([icoHeader, ...dirEntries, ...images])
fs.writeFileSync(OUTPUT, ico)
console.log(`ICO generated: ${OUTPUT} (${ico.length} bytes, ${count} sizes: ${SIZES.join(', ')}px)`)
