import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider, Spin } from 'antd'
import AppLayout from './components/AppLayout'
import ErrorBoundary from './components/ErrorBoundary'
import { useElectronAPI } from './hooks/useElectronAPI'

const Home = lazy(() => import('./pages/Home'))
const ProjectView = lazy(() => import('./pages/ProjectView'))
const InspectionView = lazy(() => import('./pages/InspectionView'))
const ProgressView = lazy(() => import('./pages/ProgressView'))
const PaymentView = lazy(() => import('./pages/PaymentView'))
const ContractView = lazy(() => import('./pages/ContractView'))
const PhotoArchiveView = lazy(() => import('./pages/PhotoArchiveView'))
const Settings = lazy(() => import('./pages/Settings'))
const TemplateCenter = lazy(() => import('./pages/TemplateCenter'))
const ProjectArchiveView = lazy(() => import('./pages/ProjectArchiveView'))
const DeliveryCenterView = lazy(() => import('./pages/DeliveryCenterView'))
const PortfolioDashboardView = lazy(() => import('./pages/PortfolioDashboardView'))

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
            <Suspense fallback={<div style={{ height: '100%', display: 'grid', placeItems: 'center' }}><Spin tip="正在加载模块…" /></div>}><Routes>
              <Route path="/" element={<AppLayout />}>
                <Route index element={<Home />} />
                <Route path="project/:projectName" element={<ProjectView />} />
                <Route path="project/:projectName/inspection" element={<InspectionView />} />
                <Route path="project/:projectName/progress" element={<ProgressView />} />
                <Route path="project/:projectName/payment" element={<PaymentView />} />
                <Route path="project/:projectName/contract" element={<ContractView />} />
                <Route path="project/:projectName/photo" element={<PhotoArchiveView />} />
                <Route path="project/:projectName/archive" element={<ProjectArchiveView />} />
                <Route path="project/:projectName/delivery" element={<DeliveryCenterView />} />
                <Route path="settings" element={<Settings />} />
                <Route path="expansion-hub" element={<Navigate to="/template-center" replace />} />
                <Route path="template-center" element={<TemplateCenter />} />
                <Route path="portfolio" element={<PortfolioDashboardView />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes></Suspense>
          </ErrorBoundary>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  )
}
