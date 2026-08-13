// 项目类型 → SOP 路由加载器
// 单一真相源：src/shared/project-type-router.json
// AI 助手生成前必须先调用 resolveProjectType() → loadProjectTypeSOP()

import routerJson from './project-type-router.json';

export type ProjectTypeKey =
  | '土建'
  | '市政'
  | '房建'
  | '信息化'
  | '园林'
  | '钢结构'
  | '装饰';

export interface ProjectTypeSOP {
  displayName: string;
  sopFile: string;
  keyWords: string[];
  enabledSections: string[];
  disabledSections: string[];
  minWordsByDocType: Record<string, number>;
}

const router = routerJson as {
  默认类型兜底: ProjectTypeKey;
  [key: string]: ProjectTypeSOP | ProjectTypeKey | string;
};

/**
 * 解析项目类型
 * @param configuredType project.config.json 中的 projectType
 * @returns 标准化的项目类型 key
 */
export function resolveProjectType(configuredType: string | undefined | null): ProjectTypeKey {
  if (!configuredType) {
    return router['默认类型兜底'] as ProjectTypeKey;
  }
  const normalized = configuredType.trim();
  // 直接匹配
  if (router[normalized]) {
    return normalized as ProjectTypeKey;
  }
  // 关键词模糊匹配（兜底）
  for (const key of Object.keys(router)) {
    if (key.startsWith('_') || key === '默认类型兜底') continue;
    const sop = router[key] as ProjectTypeSOP;
    if (sop.keyWords?.some((kw) => normalized.includes(kw))) {
      return key as ProjectTypeKey;
    }
  }
  // 全部不匹配 → 兜底
  return router['默认类型兜底'] as ProjectTypeKey;
}

/**
 * 加载项目类型对应的 SOP
 */
export function loadProjectTypeSOP(projectType: ProjectTypeKey): ProjectTypeSOP {
  return router[projectType] as ProjectTypeSOP;
}

/**
 * 输出项目类型校准声明（用于生成结果末尾）
 */
export function buildCalibrationStatement(
  projectType: ProjectTypeKey,
  docType: string,
  actualWordCount: number
): string {
  const sop = loadProjectTypeSOP(projectType);
  const minWords = sop.minWordsByDocType[docType] ?? 600;
  const wordCountOk = actualWordCount >= minWords;

  return [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📋 项目类型校准声明',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `• 项目类型：${projectType}（${sop.displayName}）`,
    `• 已加载 SOP：${sop.sopFile}`,
    `• 文档类型：${docType}`,
    `• 实际字数：${actualWordCount} 字`,
    `• 字数下限：${minWords} 字 ${wordCountOk ? '✓' : '✗ 未达标'}`,
    '• 已启用条款：',
    ...sop.enabledSections.map((s) => `  ✓ ${s}`),
    '• 已禁用条款（项目类型不适用）：',
    ...sop.disabledSections.map((s) => `  ✗ ${s}`),
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');
}