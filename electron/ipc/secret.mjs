/**
 * API Key 等敏感配置的加密存取
 *
 * 使用 Electron safeStorage：
 * - macOS:  Keychain
 * - Windows: DPAPI（绑用户账号，别的用户读不到）
 * - Linux:  GNOME Keyring / KWallet（桌面环境无 keyring 时降级明文）
 *
 * 注意：safeStorage.encryptString 在 Linux 无 keyring 时会抛错，调用方需 try/catch
 */

import { safeStorage } from 'electron'

let _encryptionAvailable = null

/**
 * 检测当前平台是否能用 OS 级加密
 */
export function isEncryptionAvailable() {
  if (_encryptionAvailable !== null) return _encryptionAvailable
  try {
    // isEncryptionAvailable 是同步方法，不会抛错
    _encryptionAvailable = safeStorage.isEncryptionAvailable()
  } catch {
    _encryptionAvailable = false
  }
  return _encryptionAvailable
}

/**
 * 运行时强制明文存储（绕过加密）—— 用于 safeStorage 出问题时的紧急逃生
 * 保存到 settings.json 后下次启动自动恢复明文模式
 */
let _forcePlainMode = false
export function setForcePlainMode(v) { _forcePlainMode = !!v }
export function isForcePlainMode() { return _forcePlainMode }

/**
 * 加密字符串 → Buffer（写入 settings.json）
 * 加密不可用时返回明文并打 warning（降级）
 */
export function encryptSecret(plain) {
  if (!plain) return null
  if (!isEncryptionAvailable()) {
    console.warn('[secret] safeStorage 不可用，apiKey 降级为明文存储（仅 Linux 无 keyring 环境）')
    return { plain }
  }
  try {
    return { encrypted: safeStorage.encryptString(plain).toString('base64') }
  } catch (e) {
    console.error('[secret] 加密失败，降级明文:', e.message)
    return { plain }
  }
}

/**
 * 解密 Buffer → 明文
 * 传入明文对象时原样返回（兼容降级数据）
 *
 * 解密失败时返回 { decryptError } 对象，让上层决定如何处理。
 * 注意：必须和 getSettings 配合使用，详见 shared.mjs 的 _apiKeyDecryptError 透传逻辑。
 */
export function decryptSecret(stored) {
  if (!stored) return ''
  if (stored.plain) return stored.plain
  if (!stored.encrypted) return ''
  if (!isEncryptionAvailable()) {
    console.warn('[secret] safeStorage 不可用，无法解密已加密的 apiKey')
    return { decryptError: 'safeStorage 不可用（系统未提供 Keychain/DPAPI）' }
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'))
  } catch (e) {
    // 详细日志：老板报告"加密后不能用，未加密能用"，需要看清原因
    console.error('[secret] ===== 解密失败 =====')
    console.error('[secret] 错误信息:', e.message)
    console.error('[secret] 常见原因：')
    console.error('  1. macOS 重装系统/换 Apple ID 后 Keychain 数据丢失')
    console.error('  2. Windows 换了用户账号（DPAPI 绑账号）')
    console.error('  3. Linux 之前有 keyring 现在没了')
    console.error('  4. 加密用的 Electron 版本和现在不一致（safeStorage 内部格式可能变了）')
    console.error('[secret] 解密失败时必须让用户重新输入 apiKey，不能静默吞错')
    return { decryptError: e.message }
  }
}

/**
 * 诊断用：在主进程启动时检查 safeStorage 是否真的可用
 * 返回 { available: bool, backend: string|null, error: string|null }
 */
export function diagnoseStorage() {
  const result = {
    available: false,
    backend: null,
    error: null,
    encryptTest: null,
    decryptTest: null,
  }
  try {
    result.available = safeStorage.isEncryptionAvailable()
    try {
      result.backend = safeStorage.getSelectedStorageBackend?.() || 'unknown'
    } catch {
      result.backend = 'unknown'
    }
    if (result.available) {
      // 端到端测试：加密→解密
      const testPlain = '__diagnose_test_' + Date.now()
      const enc = safeStorage.encryptString(testPlain)
      const dec = safeStorage.decryptString(enc)
      result.encryptTest = 'ok'
      result.decryptTest = (dec === testPlain) ? 'ok' : 'mismatch'
    }
  } catch (e) {
    result.error = e.message
  }
  return result
}
