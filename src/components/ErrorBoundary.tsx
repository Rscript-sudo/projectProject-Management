import { Component } from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      // 用纯 HTML 不依赖 antd，避免 antd 自身 useEffect 再次崩
      return (
        <div style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
          padding: 24,
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          background: '#fafafa',
          color: '#333',
        }}>
          <h2 style={{ margin: 0, color: '#ff4d4f' }}>页面出错了</h2>
          <div style={{
            maxWidth: 600,
            padding: 16,
            background: '#fff',
            border: '1px solid #f0d4d4',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: 'Menlo, Monaco, monospace',
            color: '#666',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflow: 'auto',
          }}>
            {this.state.error?.message || '未知错误'}
          </div>
          <button
            onClick={this.handleReset}
            style={{
              padding: '8px 24px',
              background: '#1677ff',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
