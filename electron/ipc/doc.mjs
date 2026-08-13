import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { app, BrowserWindow } from 'electron'
import { ensureDir, getProjectDataPath, updateLedger } from './shared.mjs'
import { getAndIncrementNumber } from './numbering.mjs'
import { buildFileName, getSubDir as getFilenameSubDir, nextVersion } from './filename.mjs'
import { isPathSafe } from './file.mjs'
import { safeCall } from './safe.mjs'
import { scanForLeftoverPlaceholders } from '../placeholderScan.mjs'
import { getMinWordCount, countEffectiveWords } from './docValidation.mjs'
// v1.2.0：主进程接入反编造铁律后处理（单一真相源：electron/shared/postProcess.mjs）
import { postProcessTimeFields, postProcessFabricationGuard } from '../shared/postProcess.mjs'

// ESM 模块无 __dirname，手动推导
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getTemplatesDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'templates')
  }
  return path.join(__dirname, '..', '..', 'templates')
}

export function register(ipcMain) {
  // v1.2.1 P0 修复：用 safeCall 包装 handler，统一异常处理
  ipcMain.handle('fs:saveDoc', safeCall(async (_, { projectPath, subDir, fileName, content, docType, projectName, userInput, savePath: customSavePath, meta, customSummary, version }) => {
    // v1.2.0：主进程入口反编造铁律（兜底，前端 ProjectView.tsx 已调用一次）
    //   避免任何非前端入口（如直接 IPC）绕开后处理
    const _guardResult = postProcessFabricationGuard(content || '')
    let _processedContent = _guardResult.content
    _processedContent = postProcessTimeFields(_processedContent)
    if (_guardResult.warnings.length > 0) {
      console.warn('[saveDoc] 反编造告警:', _guardResult.warnings.join('；'))
    }
    content = _processedContent

    // v1.0.0：入口字数硬校验（早于占位符扫描，来源：02_AI扩写型.md 第 81 行 ≥ 800 字）
    const minWords = getMinWordCount(docType)
    const actualWords = countEffectiveWords(content || '')
    if (minWords > 0 && actualWords < minWords) {
      return {
        success: false,
        error: `AI 扩写不充分：当前 ${actualWords} 字，要求 ≥ ${minWords} 字（${docType}）。请补充或重新生成。`,
      }
    }

    // v1.2.1 P0：入口扫描 AI 输出的占位符残留（防御 docxtemplater 静默吞字面量）
    const leftoverAll = scanForLeftoverPlaceholders(content || '')
    if (leftoverAll.length > 0) {
      return {
        success: false,
        error: `AI 输出含未替换占位符：${leftoverAll.slice(0, 5).join(', ')}${leftoverAll.length > 5 ? ` 等 ${leftoverAll.length} 处` : ''}。请在预览区手动补充后再保存。`,
      }
    }

    // ===== 文件名生成（虚竹 v2.0）=====
    // 优先级：前端传的 fileName > filename.mjs 自动生成
    let finalFileName = fileName
    let finalSubDir = subDir
    let filenameMeta = null
    if (!finalFileName) {
      // 自动决定修订版本（如果没传 version 且用了 customSummary）
      let autoVersion = version
      if (!autoVersion && customSummary) {
        autoVersion = nextVersion(projectPath, docType, customSummary)
      }
      const built = buildFileName({
        docType,
        projectName,
        customSummary: customSummary || '',
        version: autoVersion,
      })
      finalFileName = built.fileName
      finalSubDir = subDir || getFilenameSubDir(docType)
      filenameMeta = built
    }

    const savePath = customSavePath || path.join(projectPath, finalSubDir, finalFileName)
    // v1.2.1 P0 修复：写文件前校验路径在 home/tmp 下 + 不在敏感目录黑名单
    if (!isPathSafe(savePath)) {
      return { success: false, error: `保存路径不安全：${savePath}。仅允许写入用户主目录或系统临时目录下的非敏感路径。` }
    }
    ensureDir(path.dirname(savePath))

    console.log('[saveDoc] Saving:', { docType, projectName, fileName: finalFileName, subDir: finalSubDir, ...(filenameMeta || {}) })

    const templatesDir = getTemplatesDir()
    const { findTemplate, buildPlaceholderData, renderTemplate, renderXlsxTemplate, formatDocx } = await import('../templateService.mjs')
    let projectConfig = { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', templateOverrides: {} }
    const configPath = path.join(getProjectDataPath(projectName), 'project.config.json')
    if (fs.existsSync(configPath)) {
      try { projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) { console.warn('[saveDoc] Failed to parse project config:', e.message) }
    }
    const template = findTemplate(templatesDir, docType, { templateOverride: projectConfig.templateOverrides?.[docType] })

    if (template) {
      console.log('[saveDoc] Using template:', template.templatePath)

      // 获取自动编号（使用后递增保存）
      const autoNumber = await getAndIncrementNumber(docType, projectName)
      console.log('[saveDoc] Auto number:', autoNumber)

      const data = buildPlaceholderData({
        docType,
        projectName,
        // v1.2.0：删除假值兜底（v1.1.x 用了 '建设单位'/'施工单位' 等字面字符串作为 fallback，
        //   会通过 docxtemplater 渲染到 docx 中。改为 undefined 让模板走 default 或 AI 端占位符）
        ownerUnit: projectConfig.ownerUnit || undefined,
        contractor: projectConfig.contractor || undefined,
        supervisorUnit: projectConfig.supervisorUnit || undefined,
        chiefEngineer: projectConfig.chiefEngineer || undefined,
        userInput,
        content,
        config: template.config,
        // v1.2.5：传项目类型，渲染前做禁用术语兜底（信息化项目去塔吊/扬尘/木工等）
        projectType: projectConfig.projectType || '',
      })

      // 覆盖文件编号占位符
      data['文件编号'] = autoNumber

      console.log('[saveDoc] Placeholder keys:', Object.keys(data).join(', '))

      const engine = template.config.engine || 'docx'

      let buffer
      if (engine === 'xlsx') {
        const cellMappings = template.config.placeholder_cells || []
        buffer = await renderXlsxTemplate(template.templatePath, data, cellMappings)
      } else {
        buffer = await renderTemplate(template.templatePath, data)
      }

      fs.writeFileSync(savePath, buffer)
      await updateLedger(projectPath, finalSubDir, finalFileName, docType, meta)
      console.log('[saveDoc] Template saved OK:', savePath, 'size:', buffer.length)

      if (engine !== 'xlsx') {
        await formatDocx(savePath, true)
      }

      return { success: true, path: savePath, fileName: finalFileName, subDir: finalSubDir, filenameMeta }
    }

    // 降级方案：无模板时直接创建 docx
    console.log('[saveDoc] No template for', docType, 'creating from scratch')
    const { Document, Packer, Paragraph, TextRun } = await import('docx')
    const paragraphs = (content || '').split('\n').filter(line => line.trim())
    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs.map(line =>
          new Paragraph({
            children: [new TextRun({ text: line })],
            spacing: { after: 200, line: 276 },
          })
        ),
      }],
    })
    const buffer = await Packer.toBuffer(doc)
    fs.writeFileSync(savePath, buffer)

    await updateLedger(projectPath, finalSubDir, finalFileName, docType, meta)
    console.log('[saveDoc] Fallback saved OK:', savePath, 'size:', buffer.length)

    await formatDocx(savePath, false)

    return { success: true, path: savePath, fileName: finalFileName, subDir: finalSubDir, filenameMeta }
  }))

  ipcMain.handle('fs:exportPDF', safeCall(async (_, { projectPath, subDir, fileName, content, docType, projectName, userInput, customSummary }) => {
    // v1.2.0：主进程入口反编造铁律（与 fs:saveDoc 同源）
    const _guardResult = postProcessFabricationGuard(content || '')
    let _processedContent = _guardResult.content
    _processedContent = postProcessTimeFields(_processedContent)
    if (_guardResult.warnings.length > 0) {
      console.warn('[exportPDF] 反编造告警:', _guardResult.warnings.join('；'))
    }
    content = _processedContent

    // 文件名生成（虚竹 v2.0）—— 同步 fs:saveDoc 逻辑
    let finalFileName = fileName
    let finalSubDir = subDir
    if (!finalFileName) {
      const built = buildFileName({ docType, projectName, customSummary: customSummary || '' })
      finalFileName = built.fileName
      finalSubDir = subDir || getFilenameSubDir(docType)
    }
    const pdfFileName = finalFileName.replace(/\.(docx|xlsx)$/, '.pdf')
    const savePath = path.join(projectPath, finalSubDir, pdfFileName)
    // v1.2.1 P0 修复：写文件前校验路径
    if (!isPathSafe(savePath)) {
      return { success: false, error: `保存路径不安全：${savePath}` }
    }
    ensureDir(path.dirname(savePath))

    const templatesDir = getTemplatesDir()
    const { findTemplate, buildPlaceholderData, renderTemplate } = await import('../templateService.mjs')
    let projectConfig = { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', templateOverrides: {} }
    const configPath = path.join(getProjectDataPath(projectName), 'project.config.json')
    if (fs.existsSync(configPath)) {
      try { projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) { console.warn('[exportPDF] Failed to parse project config:', e.message) }
    }
    const template = findTemplate(templatesDir, docType, { templateOverride: projectConfig.templateOverrides?.[docType] })

    let docBuffer
    if (template) {
      const data = buildPlaceholderData({
        docType, projectName,
        // v1.2.0：删除假值兜底（与 fs:saveDoc 同源修复）
        ownerUnit: projectConfig.ownerUnit || undefined,
        contractor: projectConfig.contractor || undefined,
        supervisorUnit: projectConfig.supervisorUnit || undefined,
        chiefEngineer: projectConfig.chiefEngineer || undefined,
        userInput, content, config: template.config,
      })
      docBuffer = await renderTemplate(template.templatePath, data)
    } else {
      const { Document, Packer, Paragraph, TextRun } = await import('docx')
      const paragraphs = (content || '').split('\n').filter(line => line.trim())
      const children = paragraphs.map(line => new Paragraph({
        children: [new TextRun({ text: line })],
        spacing: { after: 200, line: 276 },
      }))
      const doc = new Document({ sections: [{ properties: {}, children }] })
      docBuffer = await Packer.toBuffer(doc)
    }

    let hiddenWin
    try {
      hiddenWin = new BrowserWindow({
        width: 794,
        height: 1123,
        show: false,
        webPreferences: { offscreen: true, nodeIntegration: false },
      })
    } catch (winErr) {
      console.error('[exportPDF] Failed to create hidden window:', winErr.message)
      return { success: false, error: '创建PDF渲染窗口失败，请重试' }
    }

    // v1.2.2 P0 修复：导出 PDF 必须用渲染后的 docBuffer（之前用 raw content 转 HTML，导致模板没套上）
    //   新路径：mammoth 把 docBuffer 转 HTML → 套打印样式 → printToPDF
    //   旧路径（已删除）：直接拿 AI 输出的 content 拼 HTML，丢模板
    let pdfData
    try {
      // 1) mammoth 把渲染后的 docx 转 HTML（保留段落/标题/表格）
      const mammoth = (await import('mammoth')).default || (await import('mammoth'))
      const mammothResult = await mammoth.convertToHtml(
        { buffer: docBuffer },
        {
          // 映射 docx 标题样式 → HTML 标签
          styleMap: [
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Title'] => h1.title:fresh",
          ],
        }
      )
      const renderedHtml = mammothResult.value || ''

      // 2) 套打印样式（仿宋、行距、首行缩进、A4 边距）
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 2.5cm 3cm; }
body { font-family: 'FangSong', 'STFangsong', 'SimSun', 'Noto Serif CJK SC', serif; font-size: 12pt; line-height: 1.75; color: #000; }
h1 { font-family: 'SimHei', 'STHeiti', 'Noto Sans CJK SC', sans-serif; font-size: 16pt; text-align: center; margin: 18pt 0 12pt; font-weight: bold; }
h2 { font-family: 'SimHei', 'STHeiti', 'Noto Sans CJK SC', sans-serif; font-size: 14pt; margin: 14pt 0 8pt; font-weight: bold; }
h3 { font-family: 'SimHei', 'STHeiti', 'Noto Sans CJK SC', sans-serif; font-size: 13pt; margin: 12pt 0 6pt; font-weight: bold; }
.title { text-align: center; font-size: 18pt; font-weight: bold; margin: 24pt 0; }
p { margin: 6pt 0; text-indent: 2em; text-align: justify; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
td, th { border: 1px solid #000; padding: 4pt 6pt; vertical-align: top; }
</style></head><body>${renderedHtml}</body></html>`

      // 3) 写临时 HTML，BrowserWindow 加载并打印
      const os = await import('os')
      const fsPromises = await import('fs/promises')
      const tmpHtmlPath = path.join(os.tmpdir(), `export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
      await fsPromises.writeFile(tmpHtmlPath, fullHtml, 'utf8')
      await hiddenWin.loadURL('file://' + tmpHtmlPath)
      await new Promise(r => setTimeout(r, 800))
      pdfData = await hiddenWin.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        pageSize: 'A4',
        margins: { top: 2.5, bottom: 2.5, left: 3, right: 3, unit: 'cm' },
      })
      // 清理临时文件
      try { await fsPromises.unlink(tmpHtmlPath) } catch (_) { /* ignore */ }
    } catch (loadErr) {
      console.warn('[exportPDF] Failed:', loadErr.message)
      if (loadErr.message.includes('URI') || loadErr.message.includes('Maximum')) {
        return { success: false, error: '文档内容过长，无法导出 PDF，请尝试缩短内容' }
      }
      return { success: false, error: 'PDF 渲染失败：' + loadErr.message }
    } finally {
      // v1.2.1 P0 修复：用 isDestroyed 守卫避免重复销毁
      if (hiddenWin && !hiddenWin.isDestroyed()) {
        hiddenWin.destroy()
      }
    }

    fs.writeFileSync(savePath, pdfData)
    await updateLedger(projectPath, finalSubDir, pdfFileName, docType)

    return { success: true, path: savePath, fileName: pdfFileName, subDir: finalSubDir }
  }))
}
