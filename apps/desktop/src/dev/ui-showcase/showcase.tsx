import { ArrowUpRight, Bell, Blocks, Check, ChevronRight, CircleHelp, Layers2, Moon, MousePointer2, PanelTop, RotateCcw, SlidersHorizontal, Sun, Type, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'

import ainoLogo from '@/assets/aino-account/logo.png'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'

import { applyShowcaseAppearance } from './appearance'
import { ComponentSections } from './component-sections'
import { Workbench } from './workbench'

const SECTIONS = [
  { id: 'overview', label: '界面总览', icon: PanelTop, description: '把组件放进真实的桌面比例中，感受一套完整的界面。' },
  { id: 'icons', label: '图标与工具栏', icon: MousePointer2, description: '统一线条、尺寸与间距，让每个操作都有清晰的位置。' },
  { id: 'buttons', label: '按钮与操作', icon: Blocks, description: '从主要操作到安静的辅助入口，层次清楚，反馈及时。' },
  { id: 'inputs', label: '输入与选择', icon: SlidersHorizontal, description: '输入、选择与校验，使用相同的尺寸和状态语言。' },
  { id: 'panels', label: '标签页与面板', icon: Layers2, description: '保留上下文，在同一个工作区中自然切换。' },
  { id: 'feedback', label: '提示与弹窗', icon: Bell, description: '让状态可见，让提醒适时，让每一步都有退路。' }
] as const

interface Notice { id: number; text: string }

export function Showcase() {
  const [section, setSection] = useState<string>('overview')
  const [dark, setDark] = useState(false)
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const active = SECTIONS.find(item => item.id === section) ?? SECTIONS[0]

  useEffect(() => applyShowcaseAppearance(dark), [dark])
  useEffect(() => {
    if (!notice) {
      return
    }

    const timeout = window.setTimeout(() => setNotice(null), 4200)

    return () => window.clearTimeout(timeout)
  }, [notice])

  const notify = (text: string) => setNotice({ id: Date.now(), text })

  return (
    <div className="ui-lab">
      <aside className="ui-lab-sidebar">
        <a className="ui-lab-brand" href="#overview" onClick={() => setSection('overview')}>
          <img alt="" height={30} src={ainoLogo} width={30} />
          <span>Aino <span className="ui-lab-brand-ui">UI</span></span>
        </a>
        <div className="ui-lab-sidebar-caption">组件展示</div>
        <nav aria-label="组件分类">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <Tip key={id} label={label} placement="toolbar">
              <button aria-current={section === id ? 'page' : undefined} aria-label={label} className="ui-lab-nav-item" onClick={() => setSection(id)} type="button">
                <Icon aria-hidden="true" size={17} strokeWidth={1.65} /><span>{label}</span>
                {section === id && <ChevronRight aria-hidden="true" className="ui-lab-nav-chevron" size={14} />}
              </button>
            </Tip>
          ))}
        </nav>
        <div className="ui-lab-sidebar-note">
          <span className="ui-lab-note-title"><CircleHelp size={15} /> 试着点一点</span>
          <p>这里的组件都可以操作。<br />演示数据仅在此页面生效。</p>
        </div>
        <div className="ui-lab-sidebar-footer"><span className="ui-lab-ready-dot" /> Aino 设计预览</div>
      </aside>

      <div className="ui-lab-body">
        <header className="ui-lab-topbar">
          <div className="ui-lab-breadcrumb"><span>设计系统</span><ChevronRight size={13} /><strong>{active.label}</strong></div>
          <div className="ui-lab-topbar-actions">
            <Tip label="重置当前演示">
              <Button aria-label="重置当前演示" onClick={() => { setRevision(value => value + 1); notify('演示已重置') }} size="icon-sm" variant="ghost"><RotateCcw size={16} /></Button>
            </Tip>
            <span className="ui-lab-action-divider" />
            <Button aria-label={dark ? '切换为浅色' : '切换为深色'} aria-pressed={dark} onClick={() => setDark(value => !value)} size="sm" variant="ghost">
              {dark ? <Moon size={16} /> : <Sun size={16} />}<span>{dark ? '深色' : '浅色'}</span>
            </Button>
          </div>
        </header>

        <main className="ui-lab-main" id="main-content" key={`${section}-${revision}`}>
          <div className="ui-lab-page-heading">
            <div><h1>{active.label}</h1><p>{active.description}</p></div>
            <span className="ui-lab-preview-label">可交互预览</span>
          </div>
          {section === 'overview' ? <Overview onNotice={notify} onSelect={setSection} /> : <ComponentSections onNotice={notify} section={section} />}
          <footer className="ui-lab-content-footer"><span>以现有 Aino 组件为基础 · 桌面优先</span><span>所有模型、消息和文件均为演示内容</span></footer>
        </main>
      </div>
      <div aria-atomic="true" aria-live="polite" className="ui-lab-toast-region">
        {notice && <div className="ui-lab-toast" key={notice.id}><Check aria-hidden="true" size={17} /><span>{notice.text}</span><Button aria-label="关闭提示" onClick={() => setNotice(null)} size="icon-xs" variant="ghost"><X size={14} /></Button></div>}
      </div>
    </div>
  )
}

interface OverviewProps { onNotice: (message: string) => void; onSelect: (section: string) => void }

function Overview({ onNotice, onSelect }: OverviewProps) {
  return <>
    <Workbench onNotice={onNotice} />
    <div className="ui-lab-specimen-heading"><h2>同一种语言，贯穿每次操作</h2><span>真实组件 · 实时交互</span></div>
    <div className="ui-lab-overview-specimens">
      <MiniSpecimen description="清晰区分主次，让操作有轻重。" onSelect={() => onSelect('buttons')} title="按钮与操作">
        <Button onClick={() => onNotice('已创建示例任务')}>新建任务</Button><Button onClick={() => onNotice('已保存示例草稿')} variant="outline">保存草稿</Button><Button disabled variant="ghost">不可用</Button>
      </MiniSpecimen>
      <MiniSpecimen description="安静的底色，一致的反馈。" onSelect={() => onSelect('inputs')} title="输入与选择">
        <div className="ui-lab-mini-input"><Type size={15} /><span>在工作区中搜索…</span><kbd>⌘ K</kbd></div>
      </MiniSpecimen>
      <MiniSpecimen description="重要的消息，恰好出现。" onSelect={() => onSelect('feedback')} title="提示与弹窗">
        <Button onClick={() => onNotice('更改已保存')} variant="secondary"><Check size={15} />保存成功</Button><Button onClick={() => onSelect('feedback')} variant="text">体验提示<ArrowUpRight size={13} /></Button>
      </MiniSpecimen>
    </div>
    <div className="ui-lab-foundations"><span>界面基准</span><div><span className="ui-lab-swatch" style={{background:'var(--ui-text-primary)'}} />石墨文字</div><div><span className="ui-lab-swatch" style={{background:'var(--ui-bg-elevated)'}} />轻盈表面</div><div><span className="ui-lab-swatch" style={{background:'var(--ui-bg-quaternary)'}} />柔和状态</div><span className="ui-lab-foundation-metric">14 px 正文</span><span className="ui-lab-foundation-metric">6 px 控件圆角</span></div>
  </>
}

interface MiniSpecimenProps { children: ReactNode; title: string; description: string; onSelect: () => void }

function MiniSpecimen({ children, title, description, onSelect }: MiniSpecimenProps) {
  return <section className="ui-lab-mini-specimen"><button className="ui-lab-specimen-link" onClick={onSelect} type="button"><h3>{title}</h3><ArrowUpRight size={15} /></button><p>{description}</p><div className="ui-lab-mini-demo">{children}</div></section>
}
