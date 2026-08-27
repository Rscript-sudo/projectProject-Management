import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { app, BrowserWindow } from 'electron'
import { ensureDir, getProjectDataPath, updateLedger } from './shared.mjs'
import { getAndIncrementNumber, previewNumber } from './numbering.mjs'
import { buildFileName, getSubDir as getFilenameSubDir, nextVersion } from './filename.mjs'
import { isPathSafe } from './file.mjs'
import { safeCall } from './safe.mjs'
import { scanForLeftoverPlaceholders } from '../placeholderScan.mjs'
import { getMinWordCount, countEffectiveWords } from './docValidation.mjs'
import { getDocumentRuleMinWords } from '../../src/shared/documentRules.mjs'
import { recordIssuedDocument, saveDocumentMasterSnapshot, getCurrentMasterProfile, validateDocumentEvidence, linkDocumentEvidence } from '../db/repo.mjs'
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

function findProfessionalForbiddenTerms(projectTypeCode, content) {
  if (!['civil', 'municipal', 'building', 'information', 'landscape', 'steel', 'decoration'].includes(projectTypeCode)) return []
  const sopPath = path.join(__dirname, '..', '..', 'src', 'shared', 'sop', projectTypeCode, 'safety-notice.json')
  if (!fs.existsSync(sopPath)) return []
  const sop = JSON.parse(fs.readFileSync(sopPath, 'utf8'))
  const terms = [
    ...(sop._禁用条款 || []),
    ...Object.values(sop.sections || {}).flatMap(section => section?.禁用术语 || []),
  ]
  return [...new Set(terms.filter(term => term && String(content).includes(term)))]
}

export function register(ipcMain) {
  // v1.2.1 P0 修复：用 safeCall 包装 handler，统一异常处理
  ipcMain.handle('fs:saveDoc', safeCall(async (_, { projectPath, subDir, fileName, content, docType, projectName, userInput, savePath: customSavePath, meta, customSummary, version, preview = false, evidenceIds = [] }) => {
    // v1.2.0：主进程入口反编造铁律（兜底，前端 ProjectView.tsx 已调用一次）
    //   避免任何非前端入口（如直接 IPC）绕开后处理
    const _guardResult = postProcessFabricationGuard(content || '')
    let _processedContent = _guardResult.content
    _processedContent = postProcessTimeFields(_processedContent)
    if (_guardResult.warnings.length > 0) {
      console.warn('[saveDoc] 反编造告警:', _guardResult.warnings.join('；'))
    }
    content = _processedContent

    // 支持前端显式传入，也支持 AI 正文中的 [来源:E123] 标记。
    const referencedEvidenceIds = [...new Set([
      ...evidenceIds,
      ...Array.from(String(content || '').matchAll(/\[来源:E(\d+)\]/g), match => Number(match[1])),
    ].map(Number).filter(Number.isInteger))]
    if (!preview && referencedEvidenceIds.length) {
      const evidenceCheck = validateDocumentEvidence(projectName, referencedEvidenceIds)
      if (!evidenceCheck.valid) {
        return { success: false, error: `未通过证据校验：${evidenceCheck.blockers.map(item => `E${item.id} ${item.reason}`).join('；')}。` }
      }
    }

    // 未核对内容必须显式阻止正式件，绝不能在保存时静默删除提示后继续签发。
    // 这也是 AI 生成与人工签发之间最关键的一道事实门禁。

    // 正式件硬门禁：不允许把未核验字段、旧校准块或跨专业术语写进 Word。
    const { validateDeliverableContent } = await import('../templateService.mjs')
    let preSaveConfig = {}
    const preSaveConfigPath = path.join(getProjectDataPath(projectName), 'project.config.json')
    if (fs.existsSync(preSaveConfigPath)) {
      try { preSaveConfig = JSON.parse(fs.readFileSync(preSaveConfigPath, 'utf8')) } catch {}
    }
    const forbiddenTerms = findProfessionalForbiddenTerms(preSaveConfig.projectTypeCode, content)
    if (!preview && forbiddenTerms.length) {
      return { success: false, error: `未通过专业 SOP 校验：发现跨专业术语 ${forbiddenTerms.join('、')}。` }
    }
    const deliverableCheck = validateDeliverableContent(content)
    if (!deliverableCheck.valid) {
      const reasons = [
        deliverableCheck.markers.length ? `未清理内容：${deliverableCheck.markers.join('、')}` : '',
      ].filter(Boolean).join('；')
      return { success: false, error: `未通过正式件校验：${reasons}。请修订后再保存。` }
    }

    // 字数是交付质量建议，不是保存门槛。短通知、联系单应允许按事实简洁成文；
    // 前端会提示建议字数并提供补充扩写，正式件仍受字段、占位符与专业术语门禁约束。
    const minWords = Math.max(getMinWordCount(docType), getDocumentRuleMinWords(docType, preSaveConfig.documentRules))
    const actualWords = countEffectiveWords(content || '')
    if (minWords > 0 && actualWords < minWords) {
      console.warn(`[saveDoc] 字数低于建议值：${actualWords}/${minWords} (${docType})，按用户选择继续保存`)
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

    // 预览件只写系统临时目录，不占正式文号、不进入任何台账，也不会污染项目资料目录。
    const savePath = preview
      ? path.join(app.getPath('temp'), '项目文档管理系统预览', finalFileName)
      : (customSavePath || path.join(projectPath, finalSubDir, finalFileName))
    // v1.2.1 P0 修复：写文件前校验路径在 home/tmp 下 + 不在敏感目录黑名单
    if (!isPathSafe(savePath)) {
      return { success: false, error: `保存路径不安全：${savePath}。仅允许写入用户主目录或系统临时目录下的非敏感路径。` }
    }
    ensureDir(path.dirname(savePath))
    const temporarySavePath = `${savePath}.${process.pid}.${Date.now()}.draft`

    console.debug('[saveDoc] Saving:', { docType, projectName, fileName: finalFileName, subDir: finalSubDir, ...(filenameMeta || {}) })

    const templatesDir = getTemplatesDir()
    const { findTemplate, buildPlaceholderData, renderTemplate, renderStructuredSystemDocument, supportsStructuredSystemLayout, validateStructuredSystemData, renderXlsxTemplate, formatDocx, validateDocxFormatting } = await import('../templateService.mjs')
    let projectConfig = { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', templateOverrides: {} }
    const configPath = path.join(getProjectDataPath(projectName), 'project.config.json')
    if (fs.existsSync(configPath)) {
      try { projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) { console.warn('[saveDoc] Failed to parse project config:', e.message) }
    }
    const currentMasterProfile = getCurrentMasterProfile(projectName)
    projectConfig = { ...projectConfig, ...Object.fromEntries(Object.entries(currentMasterProfile).filter(([, value]) => value)) }
    const { resolveLibraryTemplate } = await import('../templateRegistry.mjs')
    const libraryTemplate = resolveLibraryTemplate(app.getPath('userData'), {
      docType,
      projectType: projectConfig.projectType || '通用',
      selectedTemplateId: projectConfig.templateSelections?.[docType],
    })
    const template = findTemplate(templatesDir, docType, { templateOverride: projectConfig.templateOverrides?.[docType] || libraryTemplate })

    if (template) {
      console.debug('[saveDoc] Using template:', template.templatePath)

      // 先预览编号，全部渲染和校验通过后再正式占号，避免失败文件造成跳号。
      const previewAutoNumber = previewNumber(docType, projectName)

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
      data['文件编号'] = previewAutoNumber

      console.debug('[saveDoc] Placeholder keys:', Object.keys(data).join(', '))

      const engine = template.config.engine || 'docx'

      // 系统预置的旧表格模板不再承担长正文：改由结构化交付版输出。
      // 企业模板、项目模板仍完整尊重用户自己的字段与版式。
      const useStructuredSystemLayout = engine !== 'xlsx'
        && !projectConfig.templateOverrides?.[docType]
        && !libraryTemplate
        && supportsStructuredSystemLayout(docType)
      const renderBuffer = async () => {
        if (engine === 'xlsx') {
        const cellMappings = template.config.placeholder_cells || []
          return renderXlsxTemplate(template.templatePath, data, cellMappings)
        }
        if (useStructuredSystemLayout) {
          const structuredCheck = validateStructuredSystemData(docType, data)
          if (!structuredCheck.valid) throw new Error(`未通过正式件字段校验：${structuredCheck.missing.join('、')}未填写。请在 AI 结果中补齐对应段落后再保存。`)
          return renderStructuredSystemDocument(docType, data)
        }
        return renderTemplate(template.templatePath, data)
      }
      let buffer = await renderBuffer()

      fs.writeFileSync(temporarySavePath, buffer)

      if (engine !== 'xlsx' && !useStructuredSystemLayout) {
        await formatDocx(temporarySavePath, true, docType)
      }

      // 渲染后再扫一次，防止模板默认值、空影像字段等绕过输入层校验。
      if (engine !== 'xlsx') {
        const PizZip = (await import('pizzip')).default
        const renderedText = new PizZip(fs.readFileSync(temporarySavePath, 'binary')).file('word/document.xml')?.asText().replace(/<[^>]+>/g, '') || ''
        const renderedCheck = validateDeliverableContent(renderedText)
        if (!renderedCheck.valid) {
          try { fs.unlinkSync(temporarySavePath) } catch {}
          return { success: false, error: `模板渲染后未通过正式件校验：${renderedCheck.markers.join('、')}。文件未保留。` }
        }
        const formatCheck = await validateDocxFormatting(temporarySavePath, docType, !useStructuredSystemLayout)
        if (!formatCheck.valid) {
          try { fs.unlinkSync(temporarySavePath) } catch {}
          return { success: false, error: `文档排版验收未通过：${formatCheck.issues.join('、')}。文件未保留。` }
        }
      }

      if (preview) {
        fs.renameSync(temporarySavePath, savePath)
        return { success: true, preview: true, path: savePath, fileName: finalFileName, subDir: finalSubDir, filenameMeta }
      }
      const autoNumber = await getAndIncrementNumber(docType, projectName)
      // 单项目界面通常不会并发保存；若并发导致预览号变化，重新渲染为正式编号后才落盘。
      if (autoNumber !== previewAutoNumber) {
        data['文件编号'] = autoNumber
        buffer = await renderBuffer()
        fs.writeFileSync(temporarySavePath, buffer)
        if (engine !== 'xlsx' && !useStructuredSystemLayout) await formatDocx(temporarySavePath, true, docType)
      }
      fs.renameSync(temporarySavePath, savePath)
      await updateLedger(projectPath, finalSubDir, finalFileName, docType, { ...meta, fileNumber: autoNumber, status: '正式件' })
      const issuedDocumentId = recordIssuedDocument({ projectName, docType, fileName: finalFileName, subDir: finalSubDir, fileNumber: autoNumber, meta: { ...meta, status: '正式件' } })
      if (referencedEvidenceIds.length) linkDocumentEvidence(projectName, issuedDocumentId, referencedEvidenceIds)
      saveDocumentMasterSnapshot(projectName, savePath, docType)
      console.debug('[saveDoc] Template saved OK:', savePath, 'size:', buffer.length)

      return { success: true, path: savePath, fileName: finalFileName, subDir: finalSubDir, filenameMeta }
    }

    // 降级方案：无模板时直接创建 docx
    console.debug('[saveDoc] No template for', docType, 'creating from scratch')
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
    fs.writeFileSync(temporarySavePath, buffer)
    await formatDocx(temporarySavePath, false, docType)

    const PizZip = (await import('pizzip')).default
    const renderedText = new PizZip(fs.readFileSync(temporarySavePath, 'binary')).file('word/document.xml')?.asText().replace(/<[^>]+>/g, '') || ''
    const renderedCheck = validateDeliverableContent(renderedText)
    if (!renderedCheck.valid) {
      try { fs.unlinkSync(temporarySavePath) } catch {}
      return { success: false, error: `文档未通过正式件校验：${renderedCheck.markers.join('、')}。文件未保留。` }
    }
    const formatCheck = await validateDocxFormatting(temporarySavePath, docType)
    if (!formatCheck.valid) {
      try { fs.unlinkSync(temporarySavePath) } catch {}
      return { success: false, error: `文档排版验收未通过：${formatCheck.issues.join('、')}。文件未保留。` }
    }
    fs.renameSync(temporarySavePath, savePath)
    if (preview) return { success: true, preview: true, path: savePath, fileName: finalFileName, subDir: finalSubDir, filenameMeta }
    await updateLedger(projectPath, finalSubDir, finalFileName, docType, { ...meta, status: '正式件' })
    const issuedDocumentId = recordIssuedDocument({ projectName, docType, fileName: finalFileName, subDir: finalSubDir, meta: { ...meta, status: '正式件' } })
    if (referencedEvidenceIds.length) linkDocumentEvidence(projectName, issuedDocumentId, referencedEvidenceIds)
    saveDocumentMasterSnapshot(projectName, savePath, docType)
    console.debug('[saveDoc] Fallback saved OK:', savePath, 'size:', buffer.length)

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
    const { findTemplate, buildPlaceholderData, renderTemplate, renderStructuredSystemDocument, supportsStructuredSystemLayout, validateStructuredSystemData } = await import('../templateService.mjs')
    let projectConfig = { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', templateOverrides: {} }
    const configPath = path.join(getProjectDataPath(projectName), 'project.config.json')
    if (fs.existsSync(configPath)) {
      try { projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) { console.warn('[exportPDF] Failed to parse project config:', e.message) }
    }
    // PDF 同样可能被用户作为对外交付件，不能绕过 Word 保存时的事实与占位符门禁。
    const { validateDeliverableContent } = await import('../templateService.mjs')
    const deliverableCheck = validateDeliverableContent(content)
    if (!deliverableCheck.valid) {
      const reasons = [
        deliverableCheck.markers.length ? `未清理内容：${deliverableCheck.markers.join('、')}` : '',
      ].filter(Boolean).join('；')
      return { success: false, error: `未通过正式件校验：${reasons}。请修订后再导出 PDF。` }
    }
    const leftoverAll = scanForLeftoverPlaceholders(content || '')
    if (leftoverAll.length > 0) {
      return { success: false, error: `AI 输出含未替换占位符：${leftoverAll.slice(0, 5).join(', ')}。请补齐后再导出 PDF。` }
    }
    const { resolveLibraryTemplate } = await import('../templateRegistry.mjs')
    const libraryTemplate = resolveLibraryTemplate(app.getPath('userData'), {
      docType,
      projectType: projectConfig.projectType || '通用',
      selectedTemplateId: projectConfig.templateSelections?.[docType],
    })
    const template = findTemplate(templatesDir, docType, { templateOverride: projectConfig.templateOverrides?.[docType] || libraryTemplate })

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
      const engine = template.config.engine || 'docx'
      const useStructuredSystemLayout = engine !== 'xlsx'
        && !projectConfig.templateOverrides?.[docType]
        && !libraryTemplate
        && supportsStructuredSystemLayout(docType)
      if (useStructuredSystemLayout) {
        const structuredCheck = validateStructuredSystemData(docType, data)
        if (!structuredCheck.valid) {
          return { success: false, error: `未通过正式件字段校验：${structuredCheck.missing.join('、')}未填写。请补齐后再导出 PDF。` }
        }
        docBuffer = await renderStructuredSystemDocument(docType, data)
      } else {
        docBuffer = await renderTemplate(template.templatePath, data)
      }
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
    // PDF 是正式 Word 的派生交付物，不重复登记台账；避免同一编号出现 Word/PDF 两条记录。

    return { success: true, path: savePath, fileName: pdfFileName, subDir: finalSubDir }
  }))
}
