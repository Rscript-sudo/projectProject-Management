import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Collapse, Input, Space, Switch, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, CheckCircleOutlined, LockOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined } from '@ant-design/icons'
import { getDefaultPrompts, mergeGlobalRules } from '../shared/docTypePrompts'
import type { GlobalRule } from '../shared/docTypePrompts'
import { useSettingsStore } from '../stores/useSettingsStore'

const { Text, Title } = Typography

export default function GlobalRulesCenter({ onBack }: { onBack: () => void }) {
  const { message, modal } = App.useApp()
  const defaults = useMemo(() => getDefaultPrompts(), [])
  const { globalRulesOverrides, applyCustomTypes } = useSettingsStore()
  const [draft, setDraft] = useState<Record<string, GlobalRule>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(mergeGlobalRules(defaults.globalRules, globalRulesOverrides || undefined))
  }, [defaults, globalRulesOverrides])

  const save = async () => {
    setSaving(true)
    try {
      const overrides: Record<string, Partial<GlobalRule>> = {}
      for (const [key, rule] of Object.entries(draft)) {
        const base = defaults.globalRules[key]
        if (!base || base.locked || base.scope === 'system') continue
        const patch: Partial<GlobalRule> = {}
        if (rule.enabled !== base.enabled) patch.enabled = rule.enabled
        if (rule.content !== base.content) patch.content = rule.content
        if (Object.keys(patch).length) overrides[key] = patch
      }
      const settings = await window.electronAPI.getSettings()
      const result = await window.electronAPI.setSettings({ ...settings, globalRulesOverrides: Object.keys(overrides).length ? overrides : null })
      if (!result.success) throw new Error(result.error || '保存失败')
      const latest = await window.electronAPI.listDocTypePromptOverrides()
      applyCustomTypes(await window.electronAPI.listCustomProjectTypes(), await window.electronAPI.listCustomDocTypes(), latest?.docTypes || null, latest?.globalRules || null)
      message.success('全局规则已保存并对所有文档生效')
    } catch (error: any) {
      message.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const restoreDefaults = () => modal.confirm({
    title: '恢复全局规则默认值？',
    content: '只恢复可调整的全局规则；系统安全底线始终保持启用。',
    okText: '恢复默认',
    onOk: () => setDraft(mergeGlobalRules(defaults.globalRules)),
  })

  const systemRules = Object.values(draft).filter(rule => rule.locked || rule.scope === 'system')
  const sharedRules = Object.values(draft).filter(rule => !rule.locked && rule.scope !== 'system')

  const ruleCard = (rule: GlobalRule) => {
    const locked = !!rule.locked || rule.scope === 'system'
    return <Card key={rule.key} className="global-rule-card" size="small">
      <div className="global-rule-card__header">
        <Space size={10}>
          <span className={`global-rule-card__icon ${locked ? 'is-locked' : ''}`}>{locked ? <LockOutlined /> : <CheckCircleOutlined />}</span>
          <div><Text strong>{rule.label}</Text><div><Text type="secondary">{rule.summary}</Text></div></div>
        </Space>
        {locked ? <Tag icon={<LockOutlined />} color="blue">系统锁定</Tag> : <Switch checked={rule.enabled} checkedChildren="启用" unCheckedChildren="停用" onChange={enabled => setDraft(current => ({ ...current, [rule.key]: { ...current[rule.key], enabled } }))} />}
      </div>
      <Collapse ghost size="small" items={[{
        key: 'detail', label: locked ? '查看完整安全规则' : '查看并编辑完整规则',
        children: locked
          ? <pre className="global-rule-card__readonly">{rule.content}</pre>
          : <Input.TextArea value={rule.content} disabled={!rule.enabled} autoSize={{ minRows: 7, maxRows: 16 }} onChange={event => setDraft(current => ({ ...current, [rule.key]: { ...current[rule.key], content: event.target.value } }))} />,
      }]} />
    </Card>
  }

  return <div className="global-rules-center">
    <header className="app-page-header global-rules-center__header">
      <div className="app-page-heading">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>返回模板中心</Button>
        <span className="app-page-heading__icon"><SafetyCertificateOutlined /></span>
        <div className="app-page-heading__copy"><Title level={3} className="app-page-heading__title">全局规则</Title><Text className="app-page-heading__description">只管理所有文档共同遵守的规则，不包含具体文种、模板或字段要求</Text></div>
      </div>
      <Space><Button icon={<ReloadOutlined />} onClick={restoreDefaults}>恢复默认</Button><Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存并应用</Button></Space>
    </header>
    <Alert type="info" showIcon message="规则作用顺序：系统安全底线 → 全局文档规则 → 业务专业规则 → 文种规则 → 字段规则。下层规则不能突破系统安全底线。" />
    <section className="global-rules-center__section"><div className="global-rules-center__section-title"><Title level={4}>系统安全底线</Title><Text type="secondary">始终启用，不允许模板或用户规则关闭</Text></div>{systemRules.map(ruleCard)}</section>
    <section className="global-rules-center__section"><div className="global-rules-center__section-title"><Title level={4}>全局文档规则</Title><Text type="secondary">适用于通用、专业、私人和自定义模板</Text></div><div className="global-rules-center__grid">{sharedRules.map(ruleCard)}</div></section>
  </div>
}
