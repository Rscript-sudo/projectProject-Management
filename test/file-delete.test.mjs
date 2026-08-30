import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { register } from '../electron/ipc/file.mjs'

function setup(trashItem) {
  const handlers = new Map()
  register({ handle: (channel, handler) => handlers.set(channel, handler) }, { trashItem })
  return (...args) => handlers.get('fs:deleteFile')({}, ...args)
}

test('fs:deleteFile 可将文件和文件夹交给系统废纸篓', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-delete-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'a.txt')
  const folder = path.join(root, 'folder')
  fs.writeFileSync(file, 'x')
  fs.mkdirSync(folder)

  const trashed = []
  const call = setup(async target => { trashed.push(target) })
  assert.equal((await call(file)).success, true)
  assert.equal((await call(folder)).success, true)
  assert.deepEqual(trashed, [file, folder])
})

test('fs:deleteFile 拒绝空路径，废纸篓不可用时不会直接删除', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-delete-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'keep.txt')
  fs.writeFileSync(file, 'keep')

  assert.equal((await setup(undefined)(undefined)).success, false)
  const result = await setup(undefined)(file)
  assert.equal(result.success, false)
  assert.match(result.error, /废纸篓/)
  assert.equal(fs.existsSync(file), true)
})
