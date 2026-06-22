import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles/global.css'

// 全局错误处理：捕获渲染进程未处理的错误，在页面上展示
window.addEventListener('error', (event) => {
  console.error('[Global Error]', event.error?.message || event.message, event.error?.stack)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Global Unhandled]', event.reason?.message || event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)