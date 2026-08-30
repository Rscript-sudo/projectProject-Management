import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8')

test('主窗口启动时最大化并在小屏幕有限缩放', () => {
  assert.match(source, /show:\s*false/)
  assert.match(source, /win\.once\('ready-to-show'/)
  assert.match(source, /win\.maximize\(\)/)
  assert.match(source, /win\.webContents\.setZoomFactor\(zoomFactor\)/)
  assert.match(source, /Math\.max\(0\.85,\s*Math\.min\(1,/)
})

