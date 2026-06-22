import { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, Space, Typography, Divider, Tag, Checkbox, Spin, Descriptions, Alert, App } from 'antd'
import { SaveOutlined, CheckCircleOutlined, FolderOpenOutlined, RobotOutlined, SettingOutlined, LinkOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '../stores/useProjectStore'
import { providerConfigs, AIProvider } from '../services/aiService'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Title, Text } = Typography

export default function Settings() {
  const navigate = useNavigate()
  const location = useLocation()
  const { settings, loadSettings, saveSettings } = useAppStore()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
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

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      await saveSettings(values)
      setLoading(false)
      setSaved(true)
      message.success('设置已保存')
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setLoading(false)
      message.error('保存失败：' + (e?.message || '未知错误'))
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

  const selectedProvider = Form.useWatch('aiProvider', form) as AIProvider | undefined

  if (!apiReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin tip="正在加载设置..." />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      {/* 顶部导航 */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={() => fromHome ? navigate('/') : (window.history.length > 1 ? navigate(-1) : navigate('/'))}>返回</Button>
        <SettingOutlined style={{ fontSize: 22, color: '#1677ff' }} />
        <Title level={4} style={{ margin: 0 }}>系统设置</Title>
      </div>

      <Form form={form} layout="vertical" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ===== 基本设置 ===== */}
        <Card
          title={<Space><SettingOutlined /><span>基本设置</span></Space>}
          size="small"
        >
          <Form.Item
            name="projectRoot"
            label={<Space size={4}><FolderOpenOutlined style={{ color: '#1677ff' }} />项目根目录</Space>}
            extra="所有项目将在此目录下创建和管理"
          >
            <Input
              placeholder="选择项目根目录..."
              style={{ cursor: 'pointer' }}
              readOnly
              onClick={async () => {
                if (!window.electronAPI) return
                const dir = await window.electronAPI.selectDir()
                if (dir) {
                  form.setFieldsValue({ projectRoot: dir })
                }
              }}
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

          <Form.Item name="autoOpenFile" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>生成文档后自动用系统程序打开</Checkbox>
          </Form.Item>
        </Card>

        {/* ===== AI 模型配置 ===== */}
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
              rules={[{ required: true, message: '请输入模型名称' }]}
            >
              <Input placeholder={selectedProvider ? providerConfigs[selectedProvider]?.defaultModel || '输入模型名称' : '先选择 AI 服务商'} />
            </Form.Item>

            <Form.Item
              name="apiKey"
              label="API Key"
              rules={[{ required: true, message: '请输入 API Key' }]}
              extra="在对应 AI 平台获取"
            >
              <Input.Password placeholder="sk-..." />
            </Form.Item>

            <Form.Item
              name="baseUrl"
              label="API 地址"
              extra="使用自定义地址时填写"
            >
              <Input placeholder={selectedProvider ? providerConfigs[selectedProvider]?.baseUrl || '输入 API 地址' : '选择服务商后自动填充'} />
            </Form.Item>
          </div>

          {/* 推荐模型快速选择 */}
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

        {/* ===== 支持的模型参考 ===== */}
        <Card
          title={<Space><InfoCircleOutlined /><span>各服务商模型参考</span></Space>}
          size="small"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {Object.entries(providerConfigs).filter(([k]) => k !== 'custom').map(([key, config]) => (
              <div key={key} style={{
                padding: '12px 16px',
                background: '#fafafa',
                borderRadius: 8,
                border: '1px solid #f0f0f0',
              }}>
                <Text strong style={{ fontSize: 13 }}>{config.name}</Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                  {config.defaultModel}
                </Text>
                <a
                  href="#"
                  style={{ fontSize: 11, display: 'inline-block', marginTop: 6 }}
                  onClick={(e) => {
                    e.preventDefault()
                    form.setFieldsValue({
                      aiProvider: key as AIProvider,
                      baseUrl: config.baseUrl,
                      model: config.defaultModel,
                    })
                  }}
                >
                  应用此配置
                </a>
              </div>
            ))}
            <div style={{
              padding: '12px 16px',
              background: '#fafafa',
              borderRadius: 8,
              border: '1px solid #f0f0f0',
            }}>
              <Text strong style={{ fontSize: 13 }}>自定义</Text>
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                支持 OpenAI 兼容 API
              </Text>
            </div>
          </div>
        </Card>

        {/* ===== API Key 获取地址 ===== */}
        <Card
          title={<Space><LinkOutlined /><span>API Key 获取地址</span></Space>}
          size="small"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
            {[
              { name: 'DeepSeek', url: 'https://platform.deepseek.com' },
              { name: '智谱 AI', url: 'https://open.bigmodel.cn' },
              { name: '通义千问', url: 'https://dashscope.console.aliyun.com' },
              { name: 'Kimi', url: 'https://platform.moonshot.cn' },
              { name: 'MiniMax', url: 'https://www.minimaxi.com' },
            ].map(item => (
              <a
                key={item.name}
                href={item.url}
                target="_blank"
                rel="noopener"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: '#fafafa',
                  borderRadius: 6,
                  border: '1px solid #f0f0f0',
                  color: '#333',
                  textDecoration: 'none',
                  fontSize: 13,
                }}
              >
                <LinkOutlined style={{ color: '#1677ff', fontSize: 12 }} />
                <span>{item.name}</span>
                <Text type="secondary" style={{ fontSize: 11, flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.url.replace('https://', '')}
                </Text>
              </a>
            ))}
          </div>
        </Card>

        {/* ===== 保存按钮 ===== */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8, marginBottom: 24 }}>
          <Button
            type="primary"
            icon={saved ? <CheckCircleOutlined /> : <SaveOutlined />}
            onClick={handleSave}
            loading={loading}
            size="large"
            style={{ minWidth: 160, height: 44, fontSize: 15 }}
          >
            {saved ? '已保存' : '保存设置'}
          </Button>
        </div>
      </Form>
    </div>
  )
}
