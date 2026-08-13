import { useState, useEffect, useMemo } from 'react'
import { Card, Form, Input, Select, Button, Space, Typography, Tag, Checkbox, Spin, Descriptions, Alert, App, Tabs, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  SaveOutlined,
  CheckCircleOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  SettingOutlined,
  LinkOutlined,
  InfoCircleOutlined,
  ArrowLeftOutlined,
  DatabaseOutlined,
  KeyOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../stores/useProjectStore'
import { providerConfigs, AIProvider } from '../services/aiService'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Title, Text } = Typography

type TabKey = 'ai' | 'basic' | 'data'

const VALID_TABS: TabKey[] = ['ai', 'basic', 'data']

export default function Settings() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { settings, loadSettings, saveSettings } = useAppStore()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelFetchError, setModelFetchError] = useState<string | null>(null)
  // 支持 ?tab=ai|basic|data 直接定位 Tab（用于截图验证和深链接）
  const tabParam = searchParams.get('tab') as TabKey | null
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'ai'
  )
  const [editingApiKey, setEditingApiKey] = useState(false)
  const apiReady = useElectronAPI()

  // 判断是否从首页设置入口进入
  const fromHome = location.state?.from === 'home'

  useEffect(() => {
    if (!apiReady) return
    loadSettings().then(() => {
      const currentSettings = useAppStore.getState().settings
      form.setFieldsValue(currentSettings)
    })
  }, [apiReady])

  const handleBack = () => {
    if (fromHome) navigate('/')
    else if (window.history.length > 1) navigate(-1)
    else navigate('/')
  }

  const handleSave = async () => {
    try {
      // 校验时显式跳过 apiKey —— 后端有 hasApiKey 标志位，未配置时才需要填
      // 这样切换到 Basic/Data Tab 保存其他设置也不会被已配置的 API Key 卡住
      const FIELDS_TO_VALIDATE = ['projectRoot', 'aiProvider', 'model', 'baseUrl', 'autoOpenFile']
      await form.validateFields(FIELDS_TO_VALIDATE)
      // 用 getFieldsValue 拿真实值（不受 validateFields 内部状态延迟影响）
      const values = form.getFieldsValue(true)
      // 如果已配置 API Key 且没改，不提交 apiKey（保留原加密值）
      if (settings.hasApiKey && !values.apiKey) {
        delete values.apiKey
      }
      // 兜底：projectRoot 必须有值（否则后端写盘后会变空）
      if (!values.projectRoot) {
        message.error('请选择或填写项目根目录')
        return
      }
      setLoading(true)
      const result = await saveSettings(values)
      setLoading(false)
      if (!result || !result.success) {
        message.error('保存失败：' + (result?.error || '未知错误'))
        return
      }
      setSaved(true)
      message.success('设置已保存')
      // 重新加载以拿到新的 hasApiKey 状态
      await loadSettings()
      const updatedSettings = useAppStore.getState().settings
      form.setFieldsValue({ ...updatedSettings, apiKey: '' })
      setEditingApiKey(false)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setLoading(false)
      // antd validateFields 失败 - 显示第一个错误
      if (e?.errorFields?.length) {
        message.error('表单校验失败：' + e.errorFields[0].errors[0])
      } else {
        message.error('保存失败：' + (e?.message || '未知错误'))
      }
    }
  }

  const handleProviderChange = (provider: AIProvider) => {
    const config = providerConfigs[provider]
    if (config && provider !== 'custom') {
      form.setFieldsValue({
        baseUrl: config.baseUrl,
        model: config.defaultModel,
      })
    }
  }

  // 一键应用服务商配置（Data Tab「应用此配置」触发）
  const applyProvider = (key: string) => {
    const config = providerConfigs[key as AIProvider]
    if (!config) return
    form.setFieldsValue({
      aiProvider: key,
      baseUrl: config.baseUrl,
      model: config.defaultModel,
    })
    setActiveTab('ai')
    message.success(`已切换到 ${config.name}，请填写 API Key`)
  }

  const selectedProvider = Form.useWatch('aiProvider', form) as AIProvider | undefined

  const handleFetchModels = async () => {
    const values = form.getFieldsValue(true)
    if (!values.apiKey) {
      message.warning('请先填写 API Key')
      return
    }
    const config = providerConfigs[values.aiProvider as AIProvider]
    const baseUrl = values.baseUrl || config?.baseUrl || ''
    if (!baseUrl) {
      message.warning('请填写 API 地址')
      return
    }
    setFetchingModels(true)
    setModelFetchError(null)
    try {
      const result = await window.electronAPI.listModels({ baseUrl, apiKey: values.apiKey })
      if (result.success && result.models && result.models.length > 0) {
        setModels(result.models)
        message.success(`已获取 ${result.models.length} 个模型`)
      } else if (result.success) {
        setModelFetchError('服务商返回空模型列表，可手动输入模型名')
        message.info('该服务商未返回有效模型列表')
      } else {
        setModelFetchError(result.error || '获取失败')
        message.error(result.error || '获取模型列表失败')
      }
    } catch (e: any) {
      setModelFetchError(e?.message || '请求异常')
      message.error('获取失败：' + (e?.message || '未知错误'))
    }
    setFetchingModels(false)
  }

  // 服务商速查表数据源（从 providerConfigs 派生，自动跟随配置更新）
  const providerRows = useMemo(() => {
    const urlMap: Record<string, string> = {
      deepseek: 'https://platform.deepseek.com',
      glm: 'https://open.bigmodel.cn',
      qwen: 'https://dashscope.console.aliyun.com',
      kimi: 'https://platform.moonshot.cn',
      minimax: 'https://www.minimaxi.com',
    }
    return Object.entries(providerConfigs).map(([key, config]) => ({
      key,
      name: config.name,
      model: config.defaultModel || '自定义',
      baseUrl: config.baseUrl || '—',
      url: key === 'custom' ? '' : urlMap[key] || '',
    }))
  }, [])

  const providerColumns: ColumnsType<typeof providerRows[number]> = [
    { title: '服务商', dataIndex: 'name', width: 110, render: (n: string) => <Text strong>{n}</Text> },
    {
      title: '默认模型',
      dataIndex: 'model',
      width: 200,
      render: (m: string) => <Tag color="blue" style={{ margin: 0 }}>{m}</Tag>,
    },
    {
      title: 'API 地址',
      dataIndex: 'baseUrl',
      render: (u: string) => <Text type="secondary" style={{ fontSize: 12 }}>{u}</Text>,
    },
    {
      title: '操作',
      width: 220,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => applyProvider(row.key)}>
            应用此配置
          </Button>
          {row.url && (
            <>
              <Text type="secondary" style={{ fontSize: 11 }}>·</Text>
              <Button
                size="small"
                type="link"
                style={{ padding: 0 }}
                onClick={() => window.open(row.url, '_blank')}
              >
                获取 Key
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ]

  // ============= 顶部标题（仅展示，无按钮） =============
  const PageHeader = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0 16px',
      }}
    >
      <SettingOutlined style={{ fontSize: 20, color: '#1677ff' }} />
      <Title level={4} style={{ margin: 0 }}>系统设置</Title>
    </div>
  )

  // ============= Tab 底部操作栏（返回 + 保存设置） =============
  const TabActions = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 0 8px',
        marginTop: 8,
        borderTop: '1px solid #f0f0f0',
      }}
    >
      <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>返回</Button>
      <Button
        type="primary"
        icon={saved ? <CheckCircleOutlined /> : <SaveOutlined />}
        onClick={handleSave}
        loading={loading}
        size="large"
        style={{ minWidth: 160 }}
      >
        {saved ? '已保存' : '保存设置'}
      </Button>
    </div>
  )

  // ============= AI Tab =============
  const AITab = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={<Space><RobotOutlined /><span>AI 模型配置</span></Space>}
        size="small"
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0 16px' }}>
          <Form.Item
            name="aiProvider"
            label="AI 服务商"
            rules={[{ required: true, message: '请选择 AI 服务商' }]}
          >
            <Select
              onChange={handleProviderChange}
              placeholder="选择 AI 服务商"
              optionLabelProp="label"
            >
              {Object.entries(providerConfigs).map(([key, config]) => (
                <Select.Option key={key} value={key} label={config.name}>
                  <Space>
                    <RobotOutlined style={{ color: key === selectedProvider ? '#1677ff' : '#999' }} />
                    {config.name}
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="model"
            label="模型名称"
            rules={[{ required: true, message: '请选择模型' }]}
            extra={
              modelFetchError ? (
                <Text type="warning" style={{ fontSize: 11 }}>{modelFetchError}</Text>
              ) : models.length > 0 ? (
                <Text type="success" style={{ fontSize: 11 }}>已获取 {models.length} 个模型，直接下拉选择</Text>
              ) : (
                <Text type="secondary" style={{ fontSize: 11 }}>先填写 API Key，点右侧「获取」按钮自动拉取</Text>
              )
            }
          >
            {/* Select 与「获取」按钮用 Space.Compact 拼接，紧贴一行 */}
            <Space.Compact style={{ width: '100%' }}>
              <Select
                style={{ width: '100%' }}
                placeholder={models.length === 0
                  ? (selectedProvider ? providerConfigs[selectedProvider]?.defaultModel || '点击右侧「获取」自动拉取' : '先选择 AI 服务商')
                  : '下拉选择模型'}
                showSearch
                allowClear
                disabled={models.length === 0 && !selectedProvider}
                filterOption={(input, option) =>
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={models.length > 0
                  ? models.map(m => ({ value: m, label: m }))
                  : selectedProvider && providerConfigs[selectedProvider]?.defaultModel
                    ? [{ value: providerConfigs[selectedProvider]!.defaultModel, label: providerConfigs[selectedProvider]!.defaultModel + '（默认）' }]
                    : []}
                notFoundContent={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {models.length === 0 ? '尚未拉取模型列表，点右侧「获取」' : '无匹配'}
                  </Text>
                }
              />
              <Button
                icon={<ThunderboltOutlined />}
                loading={fetchingModels}
                onClick={handleFetchModels}
              >
                获取
              </Button>
            </Space.Compact>
          </Form.Item>

          {/* API Key：已配置时默认折叠为「已配置 + 修改入口」，避免误清空 */}
          {settings.hasApiKey && !editingApiKey ? (
            <Form.Item label={<Space size={4}><KeyOutlined style={{ color: '#1677ff' }} />API Key</Space>}>
              <Space>
                <Text type="success">✓ 已配置（加密存储，不显示明文）</Text>
                <Button size="small" type="link" onClick={() => setEditingApiKey(true)}>
                  修改 API Key
                </Button>
              </Space>
              {settings.apiKeyDecryptError && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 8 }}
                  message="已配置的 API Key 无法解密"
                  description={
                    <span>
                      原因：{settings.apiKeyDecryptError}
                      <br />
                      可能换了电脑或重装了系统，请点击「修改 API Key」重新输入。
                    </span>
                  }
                />
              )}
            </Form.Item>
          ) : (
            <Form.Item
              name="apiKey"
              label={<Space size={4}><KeyOutlined style={{ color: '#1677ff' }} />API Key</Space>}
              rules={[{ required: !settings.hasApiKey, message: '请输入 API Key' }]}
              extra={
                <Space size={4} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span>
                    {settings.apiKeyDecryptError ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="已配置的 API Key 无法解密"
                        description={
                          <span>
                            原因：{settings.apiKeyDecryptError}
                            <br />
                            可能换了电脑或重装了系统。请在下方重新输入 API Key 后保存。
                          </span>
                        }
                        style={{ marginTop: 4 }}
                      />
                    ) : editingApiKey ? (
                      <Text type="secondary">重新输入以替换原 Key</Text>
                    ) : (
                      <Text type="secondary">在对应 AI 平台获取</Text>
                    )}
                  </span>
                  {/* 诊断按钮挪到 API Key extra 右侧，与 Key 状态强关联 */}
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: 0, height: 'auto' }}
                    onClick={async () => {
                      if (!window.electronAPI?.diagnoseStorage) {
                        message.error('诊断接口不可用')
                        return
                      }
                      const result = await window.electronAPI.diagnoseStorage()
                      if (!result.available) {
                        message.error('❌ 系统不支持加密存储 (Keychain/DPAPI 不可用)')
                      } else if (result.encryptTest !== 'ok' || result.decryptTest !== 'ok') {
                        message.error(`❌ 加密/解密 round-trip 失败: encrypt=${result.encryptTest}, decrypt=${result.decryptTest}`)
                      } else {
                        message.success(`✓ 加密存储正常 (backend=${result.backend})`)
                      }
                    }}
                  >
                    诊断加密存储
                  </Button>
                </Space>
              }
            >
              <Input.Password
                placeholder={settings.hasApiKey ? '已配置，留空保持不变' : 'sk-...'}
                autoFocus={editingApiKey}
              />
            </Form.Item>
          )}

          <Form.Item
            name="baseUrl"
            label="API 地址"
            extra="使用自定义地址时填写"
          >
            {/* 输入框占满宽度，默认 baseUrl 已在 placeholder 里提示，右侧不再重复 */}
            <Input
              placeholder={selectedProvider ? providerConfigs[selectedProvider]?.baseUrl || '输入 API 地址' : '选择服务商后自动填充'}
            />
          </Form.Item>
        </div>

        {/* 推荐模型快速选择（与 Data Tab 服务商速查卡功能差异：不填 baseUrl，只切模型） */}
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
            <LinkOutlined style={{ marginRight: 4 }} />推荐模型快捷选择
          </Text>
          <Space wrap size={[4, 6]}>
            {Object.entries(providerConfigs).map(([key, config]) => (
              <Tag
                key={key}
                color={settings.aiProvider === key ? 'blue' : 'default'}
                style={{
                  cursor: 'pointer',
                  padding: '2px 10px',
                  borderRadius: 4,
                  margin: 0,
                  opacity: settings.aiProvider === key ? 1 : 0.65,
                }}
                onClick={() => {
                  form.setFieldsValue({ aiProvider: key as AIProvider, model: config.defaultModel })
                }}
              >
                {config.defaultModel || config.name}
              </Tag>
            ))}
          </Space>
        </div>
      </Card>

      <Card
        title={<Space><InfoCircleOutlined /><span>服务商速查</span></Space>}
        size="small"
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          点击「应用此配置」自动填好服务商 / API 地址 / 默认模型，再填入 API Key 即可。
        </Text>
        <Table
          size="small"
          pagination={false}
          columns={providerColumns}
          dataSource={providerRows}
          rowKey="key"
        />
      </Card>
      {TabActions}
    </Space>
  )

  // ============= Basic Tab =============
  const BasicTab = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={<Space><SettingOutlined /><span>基本设置</span></Space>}
        size="small"
      >
        <Form.Item
        name="projectRoot"
        label={<Space size={4}><FolderOpenOutlined style={{ color: '#1677ff' }} />项目根目录</Space>}
        extra={
          <span>
            所有项目将在此目录下创建和管理。可点右边文件夹图标弹窗选，也可直接输入完整路径后保存。
          </span>
        }
      >
        <Input
          placeholder="/Users/yourname/Projects 或点右边图标选择..."
          style={{ cursor: 'text' }}
          addonAfter={
            <FolderOpenOutlined
              style={{ cursor: 'pointer', color: '#1677ff' }}
              onClick={async () => {
                if (!window.electronAPI) return
                const dir = await window.electronAPI.selectDir()
                if (dir) {
                  form.setFieldsValue({ projectRoot: dir })
                }
              }}
            />
          }
        />
      </Form.Item>

      <Form.Item
        name="autoOpenFile"
        valuePropName="checked"
        extra={<span>生成监理文档（整改通知/联系单/月报等）后自动用系统默认程序打开，方便立即预览</span>}
        style={{ marginBottom: 0 }}
      >
        <Checkbox>生成文档后自动用系统程序打开</Checkbox>
      </Form.Item>
    </Card>
      {TabActions}
    </Space>
  )

  // ============= Data Tab =============
  const DataTab = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={<Space><DatabaseOutlined /><span>数据维护</span></Space>}
        size="small"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text strong>导出数据库备份</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              把所有项目数据导出为单个 .sqlite 文件（不含已生成的 Word/Excel 文档）。建议每周或重要操作后做一次。
            </Text>
          </div>
          <Button
            icon={<FolderOpenOutlined />}
            onClick={async () => {
              if (!window.electronAPI) {
                message.error('系统未就绪')
                return
              }
              try {
                const result = await window.electronAPI.dbExport()
                if (result.success) {
                  const sizeMB = ((result.size || 0) / 1024 / 1024).toFixed(2)
                  message.success(`已导出到：${result.path}（${sizeMB} MB）`)
                } else {
                  message.warning(result.error || '导出未完成')
                }
              } catch (e: any) {
                message.error('导出失败：' + (e?.message || '未知错误'))
              }
            }}
          >
            导出数据库备份
          </Button>
        </Space>
      </Card>
      {TabActions}
    </Space>
  )

  if (!apiReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin tip="正在加载设置..." />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 880, margin: '0 auto' }}>
      {PageHeader}

      {/*
        Form 必须在 Tabs 外层，form 实例共享。
        如果 Form 挂在 Tabs 内或每个 Tab 各挂一个，切换 Tab 会丢字段值。
      */}
      <Form form={form} layout="vertical">
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as TabKey)}
          items={[
            {
              key: 'ai',
              label: <Space><RobotOutlined />AI 配置</Space>,
              children: AITab,
            },
            {
              key: 'basic',
              label: <Space><SettingOutlined />基本</Space>,
              children: BasicTab,
            },
            {
              key: 'data',
              label: <Space><DatabaseOutlined />数据维护</Space>,
              children: DataTab,
            },
          ]}
        />
      </Form>
    </div>
  )
}