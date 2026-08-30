const EXACT_GUIDANCE = {
  '工程量统计表': '粘贴工程量明细，或上传 Excel',
  '监理日志': '描述当天已确认的现场情况',
  '会议纪要': '粘贴会议记录，或填写议题与结论',
  '监理周报': '填写本周已确认的进度、质量和安全事实',
  '监理月报': '填写本月已确认的进度、质量和安全事实',
  '整改通知书': '描述问题、位置及整改要求',
  '安全通知书': '描述安全问题、位置及处理要求',
  '工程联系单': '描述联系事项、已知事实和协调要求',
}

/** 小输入框只展示一句事实引导，不预填可被误发送的生成命令。 */
export function getTemplateInputPlaceholder(docType = '') {
  const name = String(docType || '').trim()
  if (!name) return '输入需求，或直接拖入现场图片…'
  if (EXACT_GUIDANCE[name]) return EXACT_GUIDANCE[name]
  if (/工程量|统计|清单|台账|明细|检查表/.test(name)) return '粘贴已确认数据，或上传表格'
  if (/通知|联系单|指令|停工令/.test(name)) return '描述具体事项、位置和处理要求'
  if (/报告|方案|规划|总结/.test(name)) return '填写已确认的事实、数据和要求'
  return '输入已确认事实，或上传相关资料'
}
