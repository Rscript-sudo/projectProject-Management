import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
function files(directory, suffixes) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name), suffixes) : suffixes.some(suffix => entry.name.endsWith(suffix)) ? [path.join(directory, entry.name)] : [])
}
const ipcFiles = files(path.join(root, 'electron'), ['.mjs', '.cjs'])
const handlers = new Map()
for (const file of ipcFiles) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)) {
    const list = handlers.get(match[1]) || []; list.push(path.relative(root, file)); handlers.set(match[1], list)
  }
}
const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8')
const invokes = new Map()
for (const match of preload.matchAll(/^\s*([A-Za-z_$][\w$]*):[^\n]*ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/gm)) invokes.set(match[1], match[2])
const declaration = fs.readFileSync(path.join(root, 'src/vite-env.d.ts'), 'utf8')
const declared = new Set([...declaration.matchAll(/^\s*([A-Za-z_$][\w$]*):\s*\(/gm)].map(match => match[1]))

const duplicateHandlers = [...handlers].filter(([, locations]) => locations.length > 1)
const missingHandlers = [...invokes].filter(([, channel]) => !handlers.has(channel))
const missingTypes = [...invokes].filter(([method]) => !declared.has(method))
if (duplicateHandlers.length || missingHandlers.length || missingTypes.length) {
  if (duplicateHandlers.length) console.error('重复 IPC handler:', duplicateHandlers)
  if (missingHandlers.length) console.error('preload 调用了未注册 channel:', missingHandlers)
  if (missingTypes.length) console.error('preload API 缺少 TypeScript 契约:', missingTypes)
  process.exit(1)
}
if (process.env.WRITE_IPC_CONTRACT) {
  const contract = { version: 1, generatedAt: new Date().toISOString(), handlerCount: handlers.size, exposedMethodCount: invokes.size, channels: Object.fromEntries([...invokes].sort().map(([method, channel]) => [method, channel])) }
  const target = path.join(root, 'dist-ipc-contract.json')
  fs.writeFileSync(target, JSON.stringify(contract, null, 2), 'utf8')
}
console.log(`IPC CONTRACT PASS: ${handlers.size} handlers / ${invokes.size} exposed methods / typed and unique`)
