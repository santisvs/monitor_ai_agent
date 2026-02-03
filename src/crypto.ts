import { createCipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32

export interface EncryptedData {
  data: string
  iv: string
  tag: string
}

/**
 * Encripta datos con AES-256-GCM.
 *
 * @param data - Objeto a encriptar
 * @param keyBase64 - Clave AES de 32 bytes en base64
 * @returns Datos encriptados con IV y tag de autenticación
 */
export function encrypt(data: unknown, keyBase64: string): EncryptedData {
  const key = Buffer.from(keyBase64, 'base64')

  if (key.length !== KEY_LENGTH) {
    throw new Error(`Clave de encriptación inválida: esperado ${KEY_LENGTH} bytes, recibido ${key.length}`)
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const jsonStr = JSON.stringify(data)
  const encrypted = Buffer.concat([
    cipher.update(jsonStr, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return {
    data: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  }
}

/**
 * Verifica si una clave de encriptación es válida (formato base64, longitud correcta)
 */
export function isValidEncryptionKey(keyBase64: string | undefined): boolean {
  if (!keyBase64) return false

  try {
    const key = Buffer.from(keyBase64, 'base64')
    return key.length === KEY_LENGTH
  } catch {
    return false
  }
}
