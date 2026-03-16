/**
 * Script de debug para ver la estructura real de los bubbles en el SQLite de Cursor.
 * Ejecutar: node debug-cursor.mjs
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

const workspaceStorageDir = path.join(
  process.env.APPDATA || '',
  'Cursor', 'User', 'workspaceStorage'
)

async function loadSqlJs() {
  const { default: init } = await import('./node_modules/sql.js/dist/sql-wasm.js')
  const wasmPath = './node_modules/sql.js/dist/sql-wasm.wasm'
  const wasmBinary = fs.readFileSync(wasmPath)
  return await init({ wasmBinary })
}

async function main() {
  console.log('Workspace storage dir:', workspaceStorageDir)

  // Buscar los 3 workspaces más recientes
  const entries = fs.readdirSync(workspaceStorageDir)
  const workspaces = entries
    .map(id => {
      const dbPath = path.join(workspaceStorageDir, id, 'state.vscdb')
      try {
        const stat = fs.statSync(path.join(workspaceStorageDir, id))
        return fs.existsSync(dbPath) ? { id, dbPath, mtime: stat.mtimeMs } : null
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 3)

  const SQL = await loadSqlJs()

  for (const ws of workspaces) {
    console.log('\n==============================')
    console.log('Workspace:', ws.id)

    const buffer = new Uint8Array(fs.readFileSync(ws.dbPath))
    const db = new SQL.Database(buffer)

    // Obtener todas las claves que parecen chat
    const keysStmt = db.prepare('SELECT key FROM ItemTable')
    const chatKeys = []
    while (keysStmt.step()) {
      const { key } = keysStmt.getAsObject()
      if (/aichat|chatdata|composer|prompt/i.test(key)) chatKeys.push(key)
    }
    keysStmt.free()

    console.log('Chat keys encontradas:', chatKeys)

    for (const key of chatKeys.slice(0, 2)) {
      const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
      stmt.bind([key])
      if (stmt.step()) {
        const { value } = stmt.getAsObject()
        stmt.free()

        try {
          const parsed = JSON.parse(value)

          // Buscar bubbles de usuario
          const tabs = parsed.tabs || parsed.allComposers || []
          let userBubbles = []

          for (const tab of tabs.slice(0, 2)) {
            const bubbles = tab.bubbles || tab.messages || []
            const userOnes = bubbles.filter(b => b.type === 'user' || b.role === 'user').slice(0, 2)
            userBubbles.push(...userOnes)
          }

          if (userBubbles.length > 0) {
            console.log(`\n--- Key: ${key} ---`)
            for (const bubble of userBubbles.slice(0, 3)) {
              console.log('\nBubble keys:', Object.keys(bubble))
              if (bubble.text) console.log('  text:', bubble.text.slice(0, 200))
              if (bubble.rawText) console.log('  rawText:', bubble.rawText.slice(0, 200))
              if (bubble.delegate) console.log('  delegate:', JSON.stringify(bubble.delegate).slice(0, 200))
              if (bubble.initText) {
                console.log('  initText (raw):', bubble.initText.slice(0, 300))
                try {
                  const parsed2 = JSON.parse(bubble.initText)
                  console.log('  initText (parsed):', JSON.stringify(parsed2, null, 2).slice(0, 500))
                } catch {}
              }
              // Mostrar todos los campos desconocidos
              const known = ['type', 'text', 'rawText', 'delegate', 'initText', 'modelType', 'selections', 'image']
              const unknown = Object.keys(bubble).filter(k => !known.includes(k))
              if (unknown.length > 0) {
                console.log('  OTROS campos:', unknown.map(k => `${k}: ${JSON.stringify(bubble[k]).slice(0, 100)}`).join('\n    '))
              }
            }
          }
        } catch (e) {
          console.log('  Error parseando:', e.message)
        }
      } else {
        stmt.free()
      }
    }

    db.close()
  }
}

main().catch(console.error)
