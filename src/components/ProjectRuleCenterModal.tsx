import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Segmented, Space, Tag, Typography } from 'antd'
import { ControlOutlined } from '@ant-design/icons'
import { DEFAULT_RULE_PACK_IDS, RULE_GROUPS, RULE_PACKS, normalizeDocumentRules } from '../shared/documentRules.mjs'

const { Text } = Typography
type Rules = { rulePackIds?: string[]; additionalInstruction?: string }

const groupForDocType = (docType?: string) => docType === '监理日志' ? '监理日志' : docType === '监理周报' ? '监理周报' : docType === '监理月报' ? '监理月报' : ['整改通知书', '安全通知书', '工程联系单', '停工令'].includes(docType || '') ? '通知与函件' : '通用底线'

export default function ProjectRuleCenterModal({ open, onClose, projectName, rules, docType, onSave }: { open: boolean; onClose: () => void; projectName: string; rules?: Rules; docType?: string; onSave: (rules: Required<Rules>) => Promise<void> }) {
  const initial = useMemo(() => normalizeDocumentRules(rules), [rules])
  const [selected, setSelected] = useState<string[]>(initial.rulePackIds)
  const [additionalInstruction, setAdditionalInstruction] = useState(initial.additionalInstruction)
  const [group, setGroup] = useState('通用底线')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { const value = normalizeDocumentRules(rules); setSelected(value.rulePackIds); setAdditionalInstruction(value.additionalInstruction); setGroup(groupForDocType(docType)) } }, [open, rules, docType])
  const packs = RULE_PACKS.filter(item => item.group === group)
  const save = async () => { setSaving(true); try { await onSave(normalizeDocumentRules({ rulePackIds: selected, additionalInstruction })) } finally { setSaving(false) } }
  return <Modal open={open} onCancel={onClose} title={<Space size={6}><ControlOutlined style={{ color: '#1677ff' }} /><span>{projectName} · {docType ? `${docType}扩写规则` : '文书规则'}</span></Space>} width={620} footer={<Space><Button onClick={onClose}>取消</Button><Button onClick={() => { setSelected(DEFAULT_RULE_PACK_IDS); setAdditionalInstruction('') }}>恢复推荐</Button><Button type="primary" loading={saving} onClick={save}>保存规则</Button></Space>}>
    <Alert showIcon type="info" style={{ marginBottom: 10 }} message="按文种选择能力包；已勾选为推荐口径。规则只影响当前项目，写文书时自动生效。" />
    <Segmented block size="small" value={group} onChange={value => setGroup(String(value))} options={RULE_GROUPS} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10, minHeight: 210 }}>
      {packs.map(item => <label key={item.id} style={{ border: `1px solid ${selected.includes(item.id) ? '#91caff' : '#edf0f5'}`, background: selected.includes(item.id) ? '#f0f7ff' : '#fff', borderRadius: 8, padding: '8px 10px', cursor: 'pointer' }}>
        <Checkbox checked={selected.includes(item.id)} onChange={event => setSelected(prev => event.target.checked ? [...prev, item.id] : prev.filter(id => id !== item.id))}><Text strong style={{ fontSize: 12 }}>{item.label}</Text></Checkbox>
        {item.minWords ? <Tag color="blue" style={{ marginLeft: 4, fontSize: 11 }}>≥{item.minWords}字</Tag> : null}
        <Text type="secondary" style={{ display: 'block', margin: '4px 0 0 24px', fontSize: 11, lineHeight: 1.45 }}>{item.description}</Text>
      </label>)}
    </div>
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0' }}>
      <Text strong style={{ fontSize: 12 }}>项目补充要求 <Tag>可选</Tag></Text>
      <Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>只填长期口径，例如“周报不设投资控制章节”。</Text>
      <Input.TextArea rows={2} maxLength={500} value={additionalInstruction} onChange={event => setAdditionalInstruction(event.target.value)} placeholder="没有特殊要求可留空" style={{ marginTop: 6 }} />
    </div>
  </Modal>
}
