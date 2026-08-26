// v1.x：「文种类型管理」Tab
// 用户可在 27 个内置 docType 之外加新文种，自定义 fileCode / minWords / 关联专业
import { useState } from 'react'
import { Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select, App, Popconfirm, Alert, Typography, Empty, Switch, Tooltip } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, FileTextOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useSettingsStore } from '../stores/useSettingsStore'
import type { CustomDocType } from '../stores/useSettingsStore'
import { getAllProjectTypes, normalizeProjectType } from '../shared/projectProfile.mjs'
import { BUILTIN_DOC_TYPES } from '../shared/builtinDocTypes'

const { Text, Paragraph } = Typography

interface Props {
  embedded?: boolean
}

export default function CustomDocTypesPanel({ embedded = false }: Props) {
  const { message } = App.useApp()
  const { customDocTypes, uploadSop, removeSop, docTypePromptOverrides } = useSettingsStore()
  const [editing, setEditing] = useState<CustomDocType | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const allProjectTypes = getAllProjectTypes()
    .filter(p => p.code !== 'unclassified')
    .map(p => ({ value: p.code, label: p.label }))

  const allDocTypes = [
    ...BUILTIN_DOC_TYPES.map(label => ({
      code: `builtin:${label}`,  // 内置项 code 用 label 前缀避免与自定义 code 冲突
      label,
      fileCode: '',
      source: 'builtin' as const,
      projectType: null,
      minWords: 600,
      inStructuredWhitelist: false,
      hasCustomSop: false,
    })),
    ...customDocTypes,
  ]

  const handleCreate = () => {
    form.resetFields()
    form.setFieldsValue({ minWords: 600, inStructuredWhitelist: false })
    setEditing(null)
    setCreating(true)
  }

  const handleEdit = (record: CustomDocType) => {
    form.setFieldsValue(record)
    setEditing(record)
    setCreating(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const settings = await window.electronAPI.getSettings()
      const list = Array.isArray(settings.customDocTypes) ? [...settings.customDocTypes] : []
      const newItem: CustomDocType = {
        code: String(values.code).trim().toLowerCase(),
        label: String(values.label).trim(),
        fileCode: String(values.fileCode).trim().toUpperCase(),
        projectType: values.projectType || null,
        minWords: Number(values.minWords) || 600,
        inStructuredWhitelist: !!values.inStructuredWhitelist,
        hasCustomSop: editing?.hasCustomSop || false,
        createdAt: editing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      if (editing) {
        const idx = list.findIndex(d => d.code === editing.code)
        if (idx >= 0) list[idx] = { ...newItem, createdAt: editing.createdAt }
        else list.push(newItem)
      } else {
        if (list.some(d => d.code === newItem.code)) {
          message.error(`code "${newItem.code}" 已存在`)
          setSubmitting(false); return
        }
        if (BUILTIN_DOC_TYPES.includes(newItem.label)) {
          message.error(`label "${newItem.label}" 与内置文种冲突`)
          setSubmitting(false); return
        }
        list.push(newItem)
      }
      const result = await window.electronAPI.setSettings({ ...settings, customDocTypes: list })
      setSubmitting(false)
      if (!result.success) {
        message.error('保存失败：' + (result.error || '未知错误'))
        return
      }
      message.success(editing ? '已更新' : '已新增')
      setCreating(false)
      setEditing(null)
    } catch (e: any) {
      setSubmitting(false)
      if (e?.errorFields) {
        message.error('表单校验失败：' + e.errorFields[0].errors[0])
      } else {
        message.error('保存失败：' + (e?.message || '未知错误'))
      }
    }
  }

  const handleDelete = async (record: CustomDocType) => {
    const settings = await window.electronAPI.getSettings()
    const list = (settings.customDocTypes || []).filter((d: CustomDocType) => d.code !== record.code)
    const result = await window.electronAPI.setSettings({ ...settings, customDocTypes: list })
    if (result.success) {
      message.success('已删除')
      await removeSop(record.code)
    } else {
      message.error('删除失败：' + (result.error || '未知错误'))
    }
  }

  const columns: ColumnsType<any> = [
    {
      title: '名称',
      dataIndex: 'label',
      width: 180,
      render: (l: string, r: any) => (
        <Space size={6}>
          <Text strong style={{ fontSize: 14 }}>{l}</Text>
          {r.source === 'custom' && <Tag color="blue">自定义</Tag>}
        </Space>
      ),
    },
    {
      title: '文件编码',
      dataIndex: 'fileCode',
      width: 120,
      render: (f: string) => f ? <Tag color="cyan">{f}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: '适用专业',
      dataIndex: 'projectType',
      width: 140,
      render: (p: string | null) => {
        if (!p) return <Text type="secondary">通用</Text>
        const code = normalizeProjectType(p)
        const profile = allProjectTypes.find(t => t.value === code)
        return profile ? profile.label : p
      },
    },
    {
      title: '字数下限',
      dataIndex: 'minWords',
      width: 100,
      render: (n: number) => <Text>{n} 字</Text>,
    },
    {
      title: '专属提示词',
      width: 120,
      align: 'center',
      render: (_, r: any) => {
        const hasPrompt = r.source === 'custom'
          ? !!docTypePromptOverrides?.[r.code]
          : !!docTypePromptOverrides?.[r.label]
        return hasPrompt
          ? <Tag color="purple">已配置</Tag>
          : <Tag color="default">未配置</Tag>
      },
    },
    {
      title: '操作',
      width: 110,
      align: 'center',
      render: (_, r) => {
        if (r.source === 'builtin') return <Text type="secondary" style={{ fontSize: 12 }}>系统内置</Text>
        return (
          <Space size={0}>
            <Tooltip title="编辑">
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEdit(r)} />
            </Tooltip>
            <Popconfirm
              title="确定删除？"
              description="已有文件引用此文种时仍可正常打开，但新建不再可选"
              okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(r)}
            >
              <Tooltip title="删除">
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message={<Text strong style={{ fontSize: 14 }}>自定义文种</Text>}
        description={
          <Paragraph style={{ marginBottom: 0, fontSize: 13, color: '#666' }}>
            新建文种后，模板中心会列出对应模板；新建文档时 docType 下拉可见；AI 走通用 prompt 骨架（不走 27 个内置 case）。
            <br />
            <Text type="secondary">fileCode 是文件名编码（如 YFB），出现在 <Text code>YYYYMMDD_YFB_xxx.docx</Text> 里。</Text>
          </Paragraph>
        }
        style={{ borderRadius: 8 }}
      />
      <Card
        title={<Space size={8}><FileTextOutlined style={{ color: '#1677ff' }} /><Text strong>文种清单</Text></Space>}
        size="small"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建文种
          </Button>
        }
        style={{ borderRadius: 8 }}
      >
        <Table
          size="middle"
          pagination={false}
          columns={columns}
          dataSource={allDocTypes}
          rowKey={(r) => r.code || r.label}
          locale={{ emptyText: <Empty description="暂无数据" /> }}
        />
      </Card>

      {/* 新建/编辑文种弹窗 */}
      <Modal
        title={editing ? `编辑文种：${editing.label}` : '新建文种'}
        open={creating}
        onCancel={() => { setCreating(false); setEditing(null) }}
        onOk={handleSubmit}
        confirmLoading={submitting}
        okText="保存" cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="label" label="名称（中文）"
            rules={[{ required: true, message: '请输入文种名称' }]}
          >
            <Input placeholder="如：监理月报附表" disabled={!!editing} />
          </Form.Item>
          <Form.Item
            name="code" label="英文 code"
            rules={[
              { required: true, message: '请输入 code' },
              { pattern: /^[a-z][a-z0-9_]{0,30}$/, message: 'code 必须英文小写开头，可含数字下划线' },
            ]}
          >
            <Input placeholder="如：monthly_report_appendix" disabled={!!editing} />
          </Form.Item>
          <Form.Item
            name="fileCode" label="文件编码"
            extra="2-10 位大写字母/数字/短横线，出现在文件名里"
            rules={[
              { required: true, message: '请输入文件编码' },
              { pattern: /^[A-Z][A-Z0-9_-]{0,9}$/, message: '必须大写字母开头，可含数字/下划线/短横线' },
            ]}
          >
            <Input placeholder="如：YFB" />
          </Form.Item>
          <Form.Item name="projectType" label="关联专业" extra="不选 = 通用文种">
            <Select allowClear placeholder="通用（不限专业）" options={allProjectTypes} />
          </Form.Item>
          <Form.Item
            name="minWords" label="字数下限"
            extra="AI 扩写达不到此字数视为不合格"
            rules={[{ required: true, message: '请输入字数下限' }]}
          >
            <InputNumber min={100} max={10000} step={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="inStructuredWhitelist" label="加入结构化白名单"
            extra="勾选 → 默认走系统结构化版式（不读模板 .docx）；不勾 → 走 docxtemplater 真模板"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
