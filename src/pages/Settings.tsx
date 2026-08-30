import { useState, useEffect, useRef } from 'react'
import { Card, Form, Input, Select, Button, Space, Typography, Tag, Checkbox, Spin, Descriptions, Alert, App, Tabs, Modal, Collapse, Badge, Divider } from 'antd'
import type { InputRef } from 'antd'
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
  CloudDownloadOutlined,
  SyncOutlined,
  ApiOutlined,
  SafetyCertificateOutlined,
  RightOutlined,
  ReloadOutlined,
  CopyOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../stores/useProjectStore'
import { providerConfigs, AIProvider } from '../services/aiService'
import type { UpdateCheckResult } from '../vite-env'
import { useElectronAPI } from '../hooks/useElectronAPI'
import './Settings.css'

const { Title, Text } = Typography

type TabKey = 'ai' | 'basic' | 'data'
type AIProfileDraft = { baseUrl: string; model: string; hasApiKey?: boolean; apiKey?: string; apiKeyDecryptError?: string | null }

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
  const [profileDrafts, setProfileDrafts] = useState<Partial<Record<AIProvider, AIProfileDraft>>>({})
  const [editingProvider, setEditingProvider] = useState<AIProvider>('deepseek')
  const [defaultProvider, setDefaultProvider] = useState<AIProvider>('deepseek')
  // 支持 ?tab=ai|basic|data 直接定位 Tab（用于截图验证和深链接）
  const tabParam = searchParams.get('tab') as TabKey | null
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'ai'
  )
  const [testingConnection, setTestingConnection] = useState(false)
  const apiKeyInputRef = useRef<InputRef>(null)
  const [appVersion, setAppVersion] = useState('—')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const apiReady = useElectronAPI()

  // 判断是否从首页设置入口进入
  const fromHome = location.state?.from === 'home'

  useEffect(() => {
    if (!apiReady) return
    loadSettings().then(() => {
      const currentSettings = useAppStore.getState().settings
      const provider = currentSettings.aiProvider as AIProvider
      const profiles = currentSettings.aiProfiles || {
        [provider]: { baseUrl: currentSettings.baseUrl, model: currentSettings.model, hasApiKey: currentSettings.hasApiKey },
      }
      setProfileDrafts(profiles)
      setEditingProvider(provider)
      setDefaultProvider(provider)
      form.setFieldsValue({ ...currentSettings, aiProvider: provider, ...(profiles[provider] || {}), apiKey: '' })
    })
    // v1.x：启动时拉一次自定义专业/文种（Store 内部会订阅主进程推送）
  }, [apiReady])

  useEffect(() => {
    if (apiReady) window.electronAPI.appInfo().then(info => setAppVersion(info.version)).catch(() => setAppVersion('未知'))
  }, [apiReady])

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    try {
      const result: UpdateCheckResult = await window.electronAPI.checkForUpdates()
      if (!result.success) throw new Error(result.error || '检查更新失败')
      if (!result.hasUpdate) {
        message.success(`当前已是最新版本 v${result.currentVersion}`)
        return
      }
      Modal.confirm({
        title: `发现新版本 v${result.latestVersion}`,
        content: `当前版本为 v${result.currentVersion}。点击“前往下载”将从 GitHub Release 打开最新版安装包；下载完成后安装即可保留现有项目数据。`,
        okText: '前往下载', cancelText: '稍后更新',
        onOk: async () => {
          const opened = await window.electronAPI.downloadUpdate(result.downloadUrl || result.releaseUrl || '')
          if (!opened.success) message.error(opened.error || '无法打开下载页面')
        },
      })
    } catch (error: any) {
      message.error(error?.message || '检查更新失败')
    } finally { setCheckingUpdate(false) }
  }

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
      const visibleApiKey = apiKeyInputRef.current?.input?.value?.trim() || ''
      const currentDraft = { ...(profileDrafts[editingProvider] || {}), baseUrl: values.baseUrl || '', model: values.model || '' }
      if (visibleApiKey) currentDraft.apiKey = visibleApiKey
      else delete currentDraft.apiKey
      const nextProfiles = { ...profileDrafts, [editingProvider]: currentDraft }
      const defaultProfile = nextProfiles[defaultProvider]
      values.aiProfiles = nextProfiles
      values.aiProvider = defaultProvider
      values.baseUrl = defaultProfile?.baseUrl || providerConfigs[defaultProvider].baseUrl
      values.model = defaultProfile?.model || providerConfigs[defaultProvider].defaultModel
      delete values.apiKey
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
      setProfileDrafts(updatedSettings.aiProfiles || {})
      form.setFieldsValue({ ...updatedSettings, ...(updatedSettings.aiProfiles?.[editingProvider] || {}), aiProvider: editingProvider, apiKey: '' })
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

  // 保存当前服务商草稿，再加载目标服务商自己的配置。
  const applyProvider = (key: string) => {
    const provider = key as AIProvider
    const config = providerConfigs[provider]
    if (!config) return
    const values = form.getFieldsValue(true)
    const visibleApiKey = apiKeyInputRef.current?.input?.value?.trim() || ''
    const currentDraft: AIProfileDraft = {
      ...(profileDrafts[editingProvider] || {}),
      baseUrl: values.baseUrl || '',
      model: values.model || '',
    }
    if (visibleApiKey) currentDraft.apiKey = visibleApiKey
    const nextDrafts = { ...profileDrafts, [editingProvider]: currentDraft }
    const target = nextDrafts[provider] || { baseUrl: config.baseUrl, model: config.defaultModel, hasApiKey: false }
    setProfileDrafts(nextDrafts)
    setEditingProvider(provider)
    form.setFieldsValue({
      aiProvider: provider,
      baseUrl: target.baseUrl,
      model: target.model,
      apiKey: target.apiKey || '',
    })
    setModels([])
    setModelFetchError(null)
    setActiveTab('ai')
  }

  const selectedProvider = Form.useWatch('aiProvider', form) as AIProvider | undefined
  const currentProvider = selectedProvider || editingProvider
  const currentProfileHasKey = !!profileDrafts[editingProvider]?.hasApiKey

  const handleFetchModels = async () => {
    const values = form.getFieldsValue(true)
    const draftApiKey = apiKeyInputRef.current?.input?.value?.trim() || values.apiKey || ''
    if (!draftApiKey && !currentProfileHasKey) {
      message.warning('请先填写 API Key')
      return
    }
    const provider = (values.aiProvider || currentProvider) as AIProvider
    const config = providerConfigs[provider]
    const baseUrl = values.baseUrl || config?.baseUrl || ''
    if (!baseUrl) {
      message.warning('请填写 API 地址')
      return
    }
    setFetchingModels(true)
    setModelFetchError(null)
    try {
      const result = await window.electronAPI.listModels({ baseUrl, apiKey: draftApiKey || undefined, provider })
      if (result.success && result.models && result.models.length > 0) {
        setModels(result.models)
        const currentModel = form.getFieldValue('model')
        const nextModel = result.models.includes(currentModel)
          ? currentModel
          : result.models.includes(config?.defaultModel)
            ? config.defaultModel
            : result.models[0]
        form.setFieldValue('model', nextModel)
        message.success(`已获取 ${result.models.length} 个模型，并自动选择 ${nextModel}`)
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

  const providerUrls: Record<string, string> = {
    deepseek: 'https://platform.deepseek.com',
    glm: 'https://open.bigmodel.cn',
    qwen: 'https://dashscope.console.aliyun.com',
    kimi: 'https://platform.moonshot.cn',
    minimax: 'https://www.minimaxi.com',
  }

  const handleTestConnection = async () => {
    const values = form.getFieldsValue(true)
    const draftApiKey = apiKeyInputRef.current?.input?.value?.trim() || values.apiKey || ''
    if (!draftApiKey && !currentProfileHasKey) {
      message.info('请先输入 API Key')
      return
    }
    setTestingConnection(true)
    try {
      const result = await window.electronAPI.listModels({ baseUrl: values.baseUrl, apiKey: draftApiKey || undefined, provider: editingProvider })
      if (!result.success) throw new Error(result.error || '连接失败')
      setModels(result.models || [])
      message.success(`连接成功${result.models?.length ? `，获取到 ${result.models.length} 个模型` : ''}`)
    } catch (error: any) {
      message.error(error?.message || '连接失败')
    } finally {
      setTestingConnection(false)
    }
  }

  const handlePasteApiKey = async () => {
    try {
      const result = await window.electronAPI.readClipboardText()
      const text = result.text?.trim() || ''
      if (!result.success || !text) {
        message.warning(result.error || '剪贴板中没有可粘贴的文本')
        return
      }
      form.setFieldValue('apiKey', text)
      message.success('密钥已粘贴，可直接获取模型或保存设置')
    } catch (error: any) {
      message.error(error?.message || '读取剪贴板失败')
    }
  }

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
    <Space direction="vertical" size={16} style={{ width: '100%' }} className="ai-settings">
      <div className="ai-settings__heading">
        <div><Title level={3}>AI 配置</Title><Text type="secondary">选择服务商并配置模型，图片识别能力可按需开启。</Text></div>
        <Tag color={currentProfileHasKey ? 'success' : 'warning'} className="ai-settings__status">
          <Badge status={currentProfileHasKey ? 'success' : 'warning'} />
          {currentProfileHasKey ? '当前服务商密钥已配置' : '当前服务商等待配置密钥'}
        </Tag>
      </div>
      <div className="ai-settings__workspace">
        <aside className="provider-panel">
          <div className="provider-panel__title">服务商</div>
          <div className="provider-panel__list">
            {Object.entries(providerConfigs).map(([key, config]) => {
              const active = currentProvider === key
              return <button type="button" key={key} className={`provider-item${active ? ' provider-item--active' : ''}`} onClick={() => applyProvider(key)}>
                <span className="provider-item__icon"><ApiOutlined /></span>
                <span className="provider-item__copy"><strong>{config.name}{defaultProvider === key && <Tag color="blue" bordered={false} className="provider-item__default">默认</Tag>}</strong><small>{profileDrafts[key as AIProvider]?.model || config.defaultModel || '自定义模型'}</small></span>
                {active ? <CheckCircleOutlined className="provider-item__check" /> : <RightOutlined className="provider-item__arrow" />}
              </button>
            })}
          </div>
          <Divider />
          <Text type="secondary" className="provider-panel__hint">选择服务商后，右侧自动填入推荐地址和默认模型。</Text>
          {currentProvider && providerUrls[currentProvider] && <Button type="link" icon={<LinkOutlined />} onClick={() => window.open(providerUrls[currentProvider], '_blank')}>获取 API Key</Button>}
        </aside>
        <main className="config-panel">
          <section className="config-section">
            <div className="config-section__header">
              <span className="config-section__icon"><SafetyCertificateOutlined /></span>
              <div><Title level={5}>访问凭据</Title><Text type="secondary">密钥使用系统安全存储，不会在界面显示明文。</Text></div>
              {currentProfileHasKey && <Tag color="success">已配置</Tag>}
            </div>
            <Form.Item name="apiKey" rules={[{ required: !currentProfileHasKey, message: '请输入 API Key' }]} extra={currentProfileHasKey ? '此服务商已保存密钥；输入新密钥可替换，留空则保持原密钥' : '每个服务商独立保存密钥；支持 ⌘V、右键粘贴或点击“粘贴”'}>
              <Space.Compact style={{ width: '100%' }}>
                <Input.Password ref={apiKeyInputRef} size="large" placeholder={currentProfileHasKey ? '输入新密钥以替换（留空则不变）' : `输入 ${providerConfigs[editingProvider].name} API Key`} />
                <Button size="large" icon={<CopyOutlined />} onClick={handlePasteApiKey}>粘贴</Button>
              </Space.Compact>
            </Form.Item>
            {profileDrafts[editingProvider]?.apiKeyDecryptError && <Alert type="warning" showIcon message="此服务商的原密钥无法解密，请重新输入并保存" />}
          </section>
          <Divider />
          <section className="config-section">
            <div className="config-section__header">
              <span className="config-section__icon config-section__icon--blue"><RobotOutlined /></span>
              <div><Title level={5}>AI 模型</Title><Text type="secondary">同一套 API 配置用于对话、文档和图片任务；具体能力由所选模型决定。</Text></div><Tag color="blue">统一配置</Tag>
            </div>
            <div className="config-grid">
              <Form.Item name="model" label="模型名称" rules={[{ required: true, message: '请选择模型' }]} extra={modelFetchError || (models.length ? `已获取 ${models.length} 个模型` : '可使用默认模型，或从服务商获取完整列表')}>
                <Space.Compact style={{ width: '100%' }}><Select showSearch options={models.length ? models.map(m => ({ value: m, label: m })) : currentProvider && providerConfigs[currentProvider]?.defaultModel ? [{ value: providerConfigs[currentProvider]!.defaultModel, label: `${providerConfigs[currentProvider]!.defaultModel}（默认）` }] : []} /><Button icon={<ThunderboltOutlined />} loading={fetchingModels} onClick={handleFetchModels}>获取模型</Button></Space.Compact>
              </Form.Item>
              <Form.Item name="baseUrl" label="API 地址" extra="选择服务商后自动填写，也可改为兼容接口地址"><Input placeholder="OpenAI 兼容接口地址" /></Form.Item>
            </div>
            <Button icon={<ReloadOutlined />} loading={testingConnection} onClick={handleTestConnection}>测试连接</Button>
            <Button
              type={defaultProvider === editingProvider ? 'primary' : 'default'}
              icon={<CheckCircleOutlined />}
              disabled={defaultProvider === editingProvider}
              onClick={() => { setDefaultProvider(editingProvider); message.success(`${providerConfigs[editingProvider].name} 已设为默认，保存设置后生效`) }}
              style={{ marginLeft: 10 }}
            >{defaultProvider === editingProvider ? '当前默认模型' : '设为默认模型'}</Button>
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>默认模型用于新建对话、文档生成和图片任务；切换服务商仅编辑配置，不会自动改变默认模型。</Text>
          </section>
          <Collapse ghost className="advanced-settings" items={[{ key: 'advanced', label: <Space><SettingOutlined /><Text strong>高级设置</Text><Text type="secondary">推荐配置与存储诊断</Text></Space>, children: <>
            <Text type="secondary">快速应用推荐配置</Text>
            <Space wrap style={{ margin: '10px 0 16px' }}>{Object.entries(providerConfigs).map(([key, config]) => <Tag key={key} className="preset-tag" onClick={() => applyProvider(key)}>{config.name} · {config.defaultModel || '自定义'}</Tag>)}</Space><br />
            <Button size="small" onClick={async () => { const result = await window.electronAPI.diagnoseStorage(); result.backend === 'local-settings' ? message.success('当前使用本机配置存储，不访问系统钥匙串') : message.info(`当前存储方式：${result.backend || '未知'}`) }}>查看密钥存储方式</Button>
          </> }]} />
        </main>
      </div>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '0 0 16px', marginBottom: 16, borderBottom: '1px solid #f0f0f0' }}>
        <div>
          <Text strong>当前版本</Text><br />
          <Text type="secondary">v{appVersion} · 更新来源：GitHub Release</Text>
        </div>
        <Button icon={checkingUpdate ? <SyncOutlined spin /> : <CloudDownloadOutlined />} loading={checkingUpdate} onClick={handleCheckUpdate}>
          检查更新
        </Button>
      </div>
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
    <div className="settings-page">
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
