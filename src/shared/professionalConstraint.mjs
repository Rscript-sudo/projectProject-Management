import { getProjectTypeProfile } from './projectProfile.mjs'

/** 模板只决定版式和字段；项目专业画像决定所有 AI 扩写的内容边界。 */
export function buildProfessionalScopeConstraint(projectInfo = {}) {
  const profile = getProjectTypeProfile(projectInfo.projectTypeCode || projectInfo.projectType)
  const tags = Array.isArray(projectInfo.projectTags) ? projectInfo.projectTags.filter(Boolean) : []
  return `【项目专业类型统一强制约束】
当前项目专业：${profile.label}（编码：${profile.code}）
专业标签：${tags.length ? tags.join('、') : '未填写'}
建设范围/项目特点：${projectInfo.projectFeatures || '未填写'}
1. 当前项目专业画像的优先级高于模板来源、模板名称、模板内旧样例和通用写作经验。
2. 内置通用模板、当前项目专业模板、私人模板、用户自定义模板及站点资料包，在 AI 扩写时全部必须遵守本约束。
3. 通用、私人或自定义模板只提供版式与字段，绝不代表可以使用其他专业的工序、设备、检查点或验收表述。
4. 专业模板只能自动匹配当前项目专业；用户即使手动选择其他专业模板，也不得把其专业内容带入当前项目。
5. 仅使用项目画像、用户事实和资料来源能够证明且属于${profile.label}的术语、工序和控制要点；无法确认时留空或标注数据待核对。`
}

