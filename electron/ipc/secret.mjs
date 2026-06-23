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
 */
export function decryptSecret(stored) {
  if (!stored) return ''
  if (stored.plain) return stored.plain
  if (!stored.encrypted) return ''
  if (!isEncryptionAvailable()) {
    console.warn('[secret] safeStorage 不可用，无法解密已加密的 apiKey')
    return ''
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'))
  } catch (e) {
    // 解密失败常见原因：
    //   1. macOS 重装系统/换 Apple ID 后 Keychain 数据丢失
    //   2. Windows 换了用户账号（DPAPI 绑账号）
    //   3. Linux 之前有 keyring 现在没了
    // 这种情况必须让用户重新输入 apiKey，不能静默吞错
    console.error('[secret] 解密失败：', e.message)
    console.error('[secret] 原因：可能是换了机器/账号/系统重装。请到设置页重新输入 API Key。')
    return { decryptError: e.message }
  }
}
