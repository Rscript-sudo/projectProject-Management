import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider, Spin } from 'antd'
import AppLayout from './components/AppLayout'
import Home from './pages/Home'
import ProjectView from './pages/ProjectView'
import InspectionView from './pages/InspectionView'
import ProgressView from './pages/ProgressView'
import PaymentView from './pages/PaymentView'
import ContractView from './pages/ContractView'
import PhotoArchiveView from './pages/PhotoArchiveView'
import Settings from './pages/Settings'
import ErrorBoundary from './components/ErrorBoundary'
import { useElectronAPI } from './hooks/useElectronAPI'

export default function App() {
  const apiReady = useElectronAPI()

  if (!apiReady) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 16,
        background: '#f5f5f5',
      }}>
        <Spin size="large" />
        <span style={{ color: '#999' }}>正在连接系统...</span>
      </div>
    )
  }

  return (
    <ConfigProvider
      theme={{ hashed: false }}
    >
      <AntApp>
        <HashRouter>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<AppLayout />}>
                <Route index element={<Home />} />
                <Route path="project/:projectName" element={<ProjectView />} />
                <Route path="project/:projectName/inspection" element={<InspectionView />} />
                <Route path="project/:projectName/progress" element={<ProgressView />} />
                <Route path="project/:projectName/payment" element={<PaymentView />} />
                <Route path="project/:projectName/contract" element={<ContractView />} />
                <Route path="project/:projectName/photo" element={<PhotoArchiveView />} />
                <Route path="settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  )
}