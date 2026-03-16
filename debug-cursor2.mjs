/**
 * Debug v2: muestra la estructura real de bubbles de usuario en Cursor SQLite.
 * node debug-cursor2.mjs
 */
import fs from 'fs'
import path from 'path'

const workspaceStorageDir = path.join(
  process.env.APPDATA || '',
  'Cursor', 'User', 'workspaceStorage'
)

async function loadSqlJs() {
  const { default: init } = await import('./node_modules/sql.js/dist/sql-wasm.js')
  const wasmBinary = fs.readFileSync('./node_modules/sql.js/dist/sql-wasm.wasm')
  return await init({ wasmBinary })
}

function readKey(db, key) {
  const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
  stmt.bind([key])
  let result = null
  if (stmt.step()) {
    const row = stmt.getAsObject()
    result = row.value
  }
  stmt.free()
  return result
}

function showBubble(bubble, index) {
  console.log(`\n  [Bubble ${index}] keys: ${Object.keys(bubble).join(', ')}`)
  const fields = ['type', 'role', 'text', 'rawText', 'commandName', 'slashCommand',
    'command', 'name', 'richText', 'content', 'message', 'prompt']
  for (const f of fields) {
    if (bubble[f] !== undefined) {
      const val = typeof bubble[f] === 'string' ? bubble[f].slice(0, 150) : JSON.stringify(bubble[f]).slice(0, 150)
      console.log(`    ${f}: ${val}`)
    }
  }
  if (bubble.delegate) console.log(`    delegate: ${JSON.stringify(bubble.delegate).slice(0, 200)}`)
  if (bubble.initText) {
    console.log(`    initText (raw): ${bubble.initText.slice(0, 200)}`)
    try {
      const p = JSON.parse(bubble.initText)
      // Traversar el árbol Lexical buscando todos los nodos
      function extractNodes(node, depth = 0) {
        if (!node || typeof node !== 'object') return
        const indent = '      ' + '  '.repeat(depth)
        if (node.type && node.type !== 'root' && node.type !== 'paragraph') {
          const nodeInfo = { type: node.type }
          if (node.text) nodeInfo.text = node.text.slice(0, 100)
          if (node.value) nodeInfo.value = String(node.value).slice(0, 100)
          if (node.data) nodeInfo.data = JSON.stringify(node.data).slice(0, 100)
          if (node.commandName) nodeInfo.commandName = node.commandName
          if (node.mentionName) nodeInfo.mentionName = node.mentionName
          if (node.slashCommand) nodeInfo.slashCommand = node.slashCommand
          // Mostrar campos desconocidos relevantes
          const known = ['type', 'text', 'version', 'format', 'indent', 'direction',
            'children', 'detail', 'mode', 'style', 'value', 'data']
          const extra = Object.keys(node).filter(k => !known.includes(k) && node[k] !== undefined)
          if (extra.length > 0) {
            nodeInfo.EXTRA = extra.map(k => `${k}:${JSON.stringify(node[k]).slice(0,80)}`).join(' | ')
          }
          if (Object.keys(nodeInfo).length > 1) {
            console.log(`${indent}NODE: ${JSON.stringify(nodeInfo)}`)
          }
        }
        if (Array.isArray(node.children)) {
          for (const child of node.children) extractNodes(child, depth + 1)
        }
      }
      extractNodes(p)
    } catch(e) {
      console.log(`    initText parse error: ${e.message}`)
    }
  }
  // Mostrar cualquier campo no conocido
  const known = ['type', 'role', 'text', 'rawText', 'initText', 'delegate', 'modelType',
    'selections', 'image', 'timestamp', 'id', 'uuid', 'messageId', 'seq', 'streaming']
  const extra = Object.keys(bubble).filter(k => !known.includes(k))
  if (extra.length > 0) {
    console.log(`    CAMPOS EXTRA: ${extra.map(k => `${k}=${JSON.stringify(bubble[k]).slice(0,100)}`).join(' | ')}`)
  }
}

async function main() {
  const SQL = await loadSqlJs()

  // Tomar el workspace más reciente
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

  for (const ws of workspaces.slice(0, 3)) {
    const buffer = new Uint8Array(fs.readFileSync(ws.dbPath))
    const db = new SQL.Database(buffer)

    // 1. aiService.prompts — formato más simple
    const prompts = readKey(db, 'aiService.prompts')
    if (prompts) {
      try {
        const parsed = JSON.parse(prompts)
        const arr = Array.isArray(parsed) ? parsed : []
        const withSlash = arr.filter(p => {
          const t = (p.text || p.prompt || p.content || JSON.stringify(p))
          return t.includes('/')
        })
        if (withSlash.length > 0) {
          console.log(`\n=== WORKSPACE ${ws.id} / aiService.prompts ===`)
          console.log('Ejemplo con "/" encontrado:')
          console.log(JSON.stringify(withSlash[0], null, 2).slice(0, 800))
          break  // Con esto es suficiente para entender el formato
        }
      } catch {}
    }

    // 2. composer.composerData — buscar bubbles con /
    const composerData = readKey(db, 'composer.composerData')
    if (composerData) {
      try {
        const parsed = JSON.parse(composerData)
        const composers = parsed.allComposers || []
        for (const comp of composers) {
          const bubbles = comp.bubbles || comp.conversation?.bubbles || []
          const userBubblesWithSlash = bubbles.filter(b => {
            if (b.type !== 'user') return false
            const text = b.text || b.rawText || b.delegate?.a || ''
            const initText = b.initText || ''
            return text.includes('/') || initText.includes('requesting') || initText.includes('writing-plans')
          })
          if (userBubblesWithSlash.length > 0) {
            console.log(`\n=== WORKSPACE ${ws.id} / composer.composerData ===`)
            console.log(`Composer: ${comp.name || comp.composerId}`)
            userBubblesWithSlash.slice(0, 3).forEach((b, i) => showBubble(b, i))
          }
        }
      } catch(e) {
        console.log('composer.composerData error:', e.message)
      }
    }

    // 3. composerChatViewPane — buscar en los más recientes
    const allKeys = []
    const keysStmt = db.prepare('SELECT key FROM ItemTable')
    while (keysStmt.step()) {
      const { key } = keysStmt.getAsObject()
      if (key.startsWith('workbench.panel.composerChatViewPane.')) allKeys.push(key)
    }
    keysStmt.free()

    for (const key of allKeys.slice(0, 5)) {
      const val = readKey(db, key)
      if (!val) continue
      try {
        const parsed = JSON.parse(val)
        const tabs = parsed.tabs || []
        for (const tab of tabs) {
          const bubbles = tab.bubbles || []
          const userBubblesWithSlash = bubbles.filter(b => {
            if (b.type !== 'user') return false
            const text = b.text || b.rawText || b.delegate?.a || ''
            const initText = b.initText || ''
            return text.includes('/') || initText.includes('requesting') || initText.includes('writing-plans') || initText.includes('superpowers')
          })
          if (userBubblesWithSlash.length > 0) {
            console.log(`\n=== WORKSPACE ${ws.id} / ${key.slice(-8)} ===`)
            userBubblesWithSlash.slice(0, 2).forEach((b, i) => showBubble(b, i))
          }
        }
      } catch {}
    }

    db.close()
  }
}

main().catch(console.error)
