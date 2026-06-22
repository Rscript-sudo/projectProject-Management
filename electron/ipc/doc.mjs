import path from 'path'
import fs from 'fs'
import { app, BrowserWindow } from 'electron'
import { ensureDir, getProjectDataPath, updateLedger } from './shared.mjs'
import { getAndIncrementNumber } from './numbering.mjs'

function getTemplatesDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'templates')
  }
  return path.join(__dirname, '..', '..', 'templates')
}

export function register(ipcMain) {
  ipcMain.handle('fs:saveDoc', async (_, { projectPath, subDir, fileName, content, docType, projectName, userInput, savePath: customSavePath, meta }) => {
    try {
      const savePath = customSavePath || path.join(projectPath, subDir, fileName)
      ensureDir(path.dirname(savePath))

      console.log('[saveDoc] Saving:', { docType, projectName, fileName })

      const templatesDir = getTemplatesDir()
      const { findTemplate, buildPlaceholderData, renderTemplate, renderXlsxTemplate, formatDocx } = await import('../templateService.mjs')
      const template = findTemplate(templatesDir, docType)

      if (template) {
        console.log('[saveDoc] Using template:', template.templatePath)

        let projectConfig = { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '' }
        const configPath = path.join(getProjectDataPath(projectName), 'project.config.json')
        if (fs.existsSync(configPath)) {
          try { projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) { console.warn('[saveDoc] Failed to parse project config:', e.message) }
        }

        // 获取自动编号（使用后递增保存）
        const autoNumber = await getAndIncrementNumber(docType, projectName)
        console.log('[saveDoc] Auto number:', autoNumber)

        const data = buildPlaceholderData({
          docType,
          projectName,
          ownerUnit: projectConfig.ownerUnit || '建设单位',
          contractor: projectConfig.contractor || '施工单位',
          supervisorUnit: projectConfig.supervisorUnit || '监理单位',
          chiefEngineer: projectConfig.chiefEngineer || '总监理工程师',
          userInput,
          content,
          config: template.config,
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
        await updateLedger(projectPath, subDir, fileName, docType, meta)
        console.log('[saveDoc] Template saved OK:', savePath, 'size:', buffer.length)

        if (engine !== 'xlsx') {
          await formatDocx(savePath, true)
        }

        return { success: true, path: savePath }
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

      await updateLedger(projectPath, subDir, fileName, docType, meta)
      console.log('[saveDoc] Fallback saved OK:', savePath, 'size:', buffer.length)

      await formatDocx(savePath, false)

      return { success: true, path: savePath }
    } catch (e) {
      console.error('[saveDoc] Error:', e.message, e.stack)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:exportPDF', async (_, { projectPath, subDir, fileName, content, docType, projectName, userInput }) => {
    try {
      const pdfFileName = fileName.replace(/\.docx$/, '.pdf')
      const savePath = path.join(projectPath, subDir, pdfFileName)
      ensureDir(path.dirname(savePath))

      const templatesDir = getTemplatesDir()
      const { findTemplate, buildPlaceholderData, renderTemplate } = await import('../templateService.mjs')
      const template = findTemplate(templatesDir, docType)

      let docBuffer
      if (template) {
        let projectConfig = { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '' }
        const configPath = path.join(getProjectDataPath(projectName), 'project.config.json')
        if (fs.existsSync(configPath)) {
          try { projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) { console.warn('[saveDoc] Failed to parse project config:', e.message) }
        }
        const data = buildPlaceholderData({
          docType, projectName,
          ownerUnit: projectConfig.ownerUnit || '建设单位',
          contractor: projectConfig.contractor || '施工单位',
          supervisorUnit: projectConfig.supervisorUnit || '监理单位',
          chiefEngineer: projectConfig.chiefEngineer || '总监理工程师',
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

      // 构造临时 HTML 内容（带打印样式）
      const MAX_CONTENT_LEN = 500000  // 限制内容长度避免 URIError
      const safeContent = (content || '').slice(0, MAX_CONTENT_LEN)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<style>
@media print {
  body { font-family: 'SimSun', 'Noto Sans CJK SC', sans-serif; font-size: 12pt; line-height: 1.8; margin: 2.5cm 3cm; }
  h1 { font-size: 18pt; text-align: center; margin-bottom: 24pt; }
  p { margin: 6pt 0; text-indent: 2em; }
}
</style>
</head>
<body>${safeContent.split('\n').map(line => {
  const trimmed = line.trim()
  if (!trimmed) return '<br/>'
  const isTitle = /^[一二三四五六七八九十]+[、.]/.test(trimmed)
  if (isTitle) return `<h1>${trimmed}</h1>`
  return `<p>${trimmed}</p>`
}).join('\n')}</body>
</html>`

      let pdfData
      try {
        await hiddenWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)
        await new Promise(r => setTimeout(r, 500))
        pdfData = await hiddenWin.webContents.printToPDF({
          printBackground: true,
          landscape: false,
          pageSize: 'A4',
          margins: { top: 2.5, bottom: 2.5, left: 3, right: 3, unit: 'cm' },
        })
      } catch (loadErr) {
        // 内容过长导致 URIError
        console.warn('[exportPDF] HTML too large:', loadErr.message)
        return { success: false, error: '文档内容过长，无法导出 PDF，请尝试缩短内容' }
      }

      fs.writeFileSync(savePath, pdfData)
      hiddenWin.destroy()
      await updateLedger(projectPath, subDir, pdfFileName, docType)

      return { success: true, path: savePath }
    } catch (e) {
      console.error('[exportPDF] Error:', e.message)
      return { success: false, error: e.message }
    } finally {
      if (hiddenWin && !hiddenWin.isDestroyed()) {
        hiddenWin.destroy()
      }
    }
  })
}
