import { useState, useEffect, useRef } from 'react'
import { Tree, App, Dropdown, Modal, Input } from 'antd'
import {
  FolderFilled,
  FileTextFilled,
  FilePdfFilled,
  FileImageFilled,
  FileExcelFilled,
  FileFilled,
  FileUnknownFilled,
  CaretRightFilled,
  CaretDownFilled,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons'
import type { DirNode } from '../vite-env'
import type { DataNode } from 'antd/es/tree'

const fileIconMap: Record<string, { icon: React.ReactNode; color: string }> = {
  '.doc':  { icon: <FileTextFilled />, color: '#2b579a' },
  '.docx': { icon: <FileTextFilled />, color: '#2b579a' },
  '.xls':  { icon: <FileExcelFilled />, color: '#217346' },
  '.xlsx': { icon: <FileExcelFilled />, color: '#217346' },
  '.pdf':  { icon: <FilePdfFilled />, color: '#d32f2f' },
  '.jpg':  { icon: <FileImageFilled />, color: '#e91e63' },
  '.jpeg': { icon: <FileImageFilled />, color: '#e91e63' },
  '.png':  { icon: <FileImageFilled />, color: '#e91e63' },
  '.gif':  { icon: <FileImageFilled />, color: '#e91e63' },
  '.json': { icon: <FileFilled />, color: '#f9a825' },
  '.txt':  { icon: <FileTextFilled />, color: '#78909c' },
  '.md':   { icon: <FileTextFilled />, color: '#42a5f5' },
}

function getFileIcon(ext: string): React.ReactNode {
  const info = fileIconMap[ext]
  if (info) {
    return <span style={{ color: info.color, fontSize: 11, lineHeight: '22px' }}>{info.icon}</span>
  }
  return <FileUnknownFilled style={{ color: '#bbb', fontSize: 11 }} />
}

interface DirTreeProps {
  dirTree: DirNode | null
  onFileClick: (path: string) => void
  onFolderSelect?: (path: string) => void
  onFileDelete?: (path: string) => Promise<boolean>
  onRefresh?: () => void
}

export default function DirTree({ dirTree, onFileClick, onFolderSelect, onFileDelete, onRefresh }: DirTreeProps) {
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [selectedKey, setSelectedKey] = useState<React.Key | null>(null)
  const [contextMenu, setContextMenu] = useState<{ items: any[] }>({ items: [] })
  const { modal, message } = App.useApp()
  const containerRef = useRef<HTMLDivElement>(null)

  // Track hovered file for floating delete button
  const [hoveredFile, setHoveredFile] = useState<{ path: string; name: string; anchorRect: DOMRect } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverNodeRef = useRef<{ path: string; name: string } | null>(null)

  // 清理 hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  useEffect(() => {
    // 切换目录树时重置展开状态，只展开新根目录
    if (dirTree) {
      setExpandedKeys([dirTree.path] as React.Key[])
    }
  }, [dirTree?.path])

  if (!dirTree) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13 }}>
        加载中...
      </div>
    )
  }

  const handleDeleteRequest = (filePath: string, fileName: string) => {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除文件"${fileName}"吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!onFileDelete) return
        try {
          const ok = await onFileDelete(filePath)
          if (ok) {
            message.success(`"${fileName}" 已删除`)
          }
        } catch (e: any) {
          message.error('删除失败：' + (e?.message || '未知错误'))
        }
      },
      onCancel: () => {},
    })
  }

  // 重命名
  const handleRename = (node: DirNode) => {
    const path = node.path
    const oldName = node.name
    let newName = ''
    Modal.confirm({
      title: '重命名',
      icon: <EditOutlined />,
      content: (
        <Input
          defaultValue={oldName}
          autoFocus
          onChange={e => { newName = e.target.value }}
          onPressEnter={async () => {
            const trimmed = newName.trim()
            if (!trimmed || trimmed === oldName) return
            const result = await window.electronAPI.renameFile(path, trimmed)
            if (result.success) {
              message.success('已重命名')
              onRefresh?.()
            } else {
              message.error('重命名失败：' + (result.error || ''))
            }
          }}
        />
      ),
      onOk: async () => {
        const trimmed = (newName || '').trim()
        if (!trimmed || trimmed === oldName) return
        const result = await window.electronAPI.renameFile(path, trimmed)
        if (result.success) {
          message.success('已重命名')
          onRefresh?.()
        } else {
          message.error('重命名失败：' + (result.error || ''))
        }
      },
    })
  }

  // 复制路径
  const handleCopyPath = async (path: string) => {
    const result = await window.electronAPI.copyPath(path)
    if (result.success) message.success('路径已复制')
    else message.error('复制失败')
  }

  // 右键菜单项
  const buildContextMenu = (node: DirNode) => {
    const isFolder = node.type === 'folder'
    const items = [
      {
        key: 'open',
        label: isFolder ? '在文件管理器中打开' : '打开文件',
        icon: isFolder ? <FolderOpenOutlined /> : <FileTextFilled />,
        onClick: () => {
          if (isFolder) window.electronAPI.openPath(node.path)
          else onFileClick(node.path)
        },
      },
      { type: 'divider' as const },
      {
        key: 'rename',
        label: '重命名',
        icon: <EditOutlined />,
        onClick: () => handleRename(node),
      },
      {
        key: 'copy',
        label: '复制路径',
        icon: <CopyOutlined />,
        onClick: () => handleCopyPath(node.path),
      },
      { type: 'divider' as const },
      {
        key: 'delete',
        label: '删除',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => handleDeleteRequest(node.path, node.name),
      },
    ]
    return { items }
  }

  const handleSelect = (keys: React.Key[], info: { node: DataNode }) => {
    if (keys.length > 0) {
      const key = keys[0]
      setSelectedKey(key)
      if (info.node.isLeaf) {
        onFileClick(key as string)
      } else if (onFolderSelect) {
        onFolderSelect(key as string)
      }
    }
  }

  const handleFileMouseEnter = (node: DirNode, e: React.MouseEvent) => {
    if (!onFileDelete) return
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    // 捕获当前节点的 path/name/rect，避免闭包 stale 问题
    hoverNodeRef.current = { path: node.path, name: node.name }
    const rect = e.currentTarget.getBoundingClientRect()
    hoverTimerRef.current = setTimeout(() => {
      if (hoverNodeRef.current) {
        setHoveredFile({ path: hoverNodeRef.current.path, name: hoverNodeRef.current.name, anchorRect: rect })
      }
    }, 300)
  }

  const handleFileMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverNodeRef.current = null
    hoverTimerRef.current = setTimeout(() => setHoveredFile(null), 200)
  }

  const handleFloatingDeleteMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
  }

  const handleFloatingDeleteMouseLeave = () => {
    hoverTimerRef.current = setTimeout(() => setHoveredFile(null), 200)
  }

  const dirToTreeData = (node: DirNode): DataNode => {
    const isRoot = node.path === dirTree.path
    const isFolder = node.type === 'folder'
    const childCount = node.children?.length || 0

    if (isFolder) {
      return {
        key: node.path,
        title: (
          <span style={{
            fontSize: 12,
            color: isRoot ? '#1a1a1a' : '#333',
            fontWeight: isRoot ? 600 : 400,
            lineHeight: '22px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
          }}>
            <FolderFilled style={{ color: '#faad14', fontSize: 11, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.name}
            </span>
            {!isRoot && childCount > 0 && (
              <span className="tree-count-badge">{childCount}</span>
            )}
          </span>
        ),
        icon: null,
        children: node.children ? node.children.map(c => dirToTreeData(c)) : [],
        isLeaf: false,
      }
    } else {
      return {
        key: node.path,
        title: (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              width: '100%',
              fontSize: 12,
              color: '#666',
              lineHeight: '22px',
            }}
            onMouseEnter={(e) => handleFileMouseEnter(node, e)}
            onMouseLeave={handleFileMouseLeave}
          >
            {getFileIcon(node.ext || '')}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.name}
            </span>
          </span>
        ),
        icon: null,
        isLeaf: true,
      }
    }
  }

  const treeData = [dirToTreeData(dirTree)]

  const getFloatingDeleteStyle = (): React.CSSProperties => {
    if (!hoveredFile?.anchorRect || !containerRef.current) return { display: 'none' }
    const containerRect = containerRef.current.getBoundingClientRect()
    const scrollTop = containerRef.current.scrollTop
    const top = hoveredFile.anchorRect.top - containerRect.top + 22 - scrollTop
    return {
      position: 'absolute',
      top: Math.max(0, top),
      right: 8,
      zIndex: 10,
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <Dropdown
        menu={contextMenu}
        trigger={['contextMenu']}
      >
        <div>
          <Tree
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={selectedKey ? [selectedKey] : []}
            onExpand={(keys) => {
              if (Array.isArray(keys)) {
                setExpandedKeys(keys as React.Key[])
              } else if (keys && typeof keys === 'object') {
                // antd may pass { node, action } object — skip silently
              }
            }}
            onSelect={handleSelect}
            onRightClick={({ node }) => {
              setContextMenu(buildContextMenu(node as unknown as DirNode))
            }}
            showIcon={false}
            blockNode
            style={{
              background: 'transparent',
              padding: '2px 0',
              fontSize: 12,
            }}
            className="project-dir-tree"
          />
        </div>
      </Dropdown>
      {hoveredFile && onFileDelete && (
        <div
          style={getFloatingDeleteStyle()}
          onMouseEnter={handleFloatingDeleteMouseEnter}
          onMouseLeave={handleFloatingDeleteMouseLeave}
        >
          <button
            type="button"
            className="file-delete-btn"
            onClick={() => handleDeleteRequest(hoveredFile.path, hoveredFile.name)}
            title="删除文件"
          >
            <DeleteOutlined style={{ marginRight: 2 }} />
            删除
          </button>
        </div>
      )}
    </div>
  )
}
