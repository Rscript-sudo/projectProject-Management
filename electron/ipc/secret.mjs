/**
 * API Key 本机存储策略。
 *
 * 本应用是单用户本机工具，直接把密钥写入用户数据目录的 settings.json。
 * 不再调用 Electron safeStorage，避免未签名或升级后的应用反复请求 macOS
 * 钥匙串授权。settings.json 仍受当前系统用户的文件权限保护。
 */

export function isEncryptionAvailable() { return false }
export function setForcePlainMode() {}
export function isForcePlainMode() { return true }

export function encryptSecret(plain) {
  if (!plain) return null
  return { plain: String(plain) }
}

export function decryptSecret(stored) {
  if (!stored) return ''
  if (stored.plain) return String(stored.plain)
  if (stored.encrypted) {
    return { decryptError: '检测到旧版加密 API Key。应用已停用钥匙串访问，请在 AI 设置中重新输入并保存一次。' }
  }
  return ''
}

export function diagnoseStorage() {
  return {
    available: true,
    backend: 'local-settings',
    error: null,
    encryptTest: 'not-required',
    decryptTest: 'not-required',
    mode: 'plain',
  }
}
