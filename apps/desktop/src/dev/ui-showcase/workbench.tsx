import { ArrowUp, Bot, Check, ChevronDown, ChevronRight, FileText, Folder, MessageSquare, MoreHorizontal, Plus, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import ainoLogo from '@/assets/aino-account/logo.png'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { ToolIcon } from '@/components/ui/tool-icon'
import { Tip } from '@/components/ui/tooltip'
import { WindowChromeIcon } from '@/components/ui/window-chrome-icon'

interface WorkbenchProps { onNotice: (message: string) => void }
interface DemoMessage { role: 'user' | 'assistant'; text: string }

export function Workbench({ onNotice }: WorkbenchProps) {
  const [sidebar, setSidebar] = useState(true)
  const [panel, setPanel] = useState(false)
  const [tab, setTab] = useState('chat')
  const [title, setTitle] = useState('桌面界面优化')
  const [messages, setMessages] = useState<DemoMessage[]>([])

  const freshChat = () => { setMessages([]); setTitle('新会话'); setTab('chat'); onNotice('已打开新的演示会话') }

  return <section aria-label="桌面工作区交互演示" className="ui-lab-workbench">
    <div className="ui-lab-windowbar">
      <div className="ui-lab-window-start"><span aria-hidden="true" className="ui-lab-window-dots"><i /><i /><i /></span><ToolbarAction active={sidebar} label={sidebar ? '收起演示导航' : '展开演示导航'} name="layout-sidebar-left" onClick={() => setSidebar(value => !value)} /></div>
      <span className="ui-lab-window-title"><Folder size={15} /> Aino 工作区</span>
      <div className="ui-lab-window-actions"><DemoNotifications /><ToolbarAction active={panel} label="会话资源" name="list" onClick={() => setPanel(value => !value)} /><ToolbarAction active={panel} label={panel ? '收起演示面板' : '打开演示面板'} name="layout-sidebar-right" onClick={() => setPanel(value => !value)} /></div>
    </div>
    <div className="ui-lab-workspace" data-panel={panel} data-sidebar={sidebar}>
      {sidebar && <aside className="ui-lab-demo-sidebar">
        <div className="ui-lab-demo-brand"><img alt="" height={25} src={ainoLogo} width={25} /><strong>Aino</strong><ChevronDown size={13} /></div>
        <Button className="ui-lab-new-chat" onClick={freshChat} variant="ghost"><Plus size={16} />新建会话</Button>
        <div className="ui-lab-demo-section-label">最近会话</div>
        <button aria-current={title === '桌面界面优化' ? 'page' : undefined} className="ui-lab-demo-session" onClick={() => { setTitle('桌面界面优化'); setMessages([]); setTab('chat') }} type="button"><MessageSquare size={14} /><span>桌面界面优化</span></button>
        <button aria-current={title === '本周工作计划' ? 'page' : undefined} className="ui-lab-demo-session" onClick={() => { setTitle('本周工作计划'); setMessages([]); setTab('chat') }} type="button"><MessageSquare size={14} /><span>本周工作计划</span></button>
        <div className="ui-lab-demo-section-label">机器人</div>
        <button aria-current={tab === 'bot' ? 'page' : undefined} className="ui-lab-demo-session" onClick={() => setTab('bot')} type="button"><Bot size={15} /><span>设计助手</span></button>
        <div className="ui-lab-demo-sidebar-bottom"><span className="ui-lab-ready-dot" />本地演示</div>
      </aside>}
      <div className="ui-lab-demo-main">
        <div className="ui-lab-demo-tabbar">
          <div aria-label="演示工作区标签" className="ui-lab-demo-tabs" role="tablist">
            {[
              { id: 'chat', label: '会话', icon: MessageSquare },
              { id: 'bot', label: 'Bot', icon: Bot },
              { id: 'file', label: '设计说明.md', icon: FileText }
            ].map(({ id, label, icon: Icon }) => (
              <button
                aria-controls={`demo-panel-${id}`}
                aria-selected={tab === id}
                className="ui-lab-demo-tab"
                id={`demo-tab-${id}`}
                key={id}
                onClick={() => setTab(id)}
                onKeyDown={event => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    const tabs = ['chat', 'bot', 'file']
                    const offset = event.key === 'ArrowRight' ? 1 : 2
                    const next = tabs[(tabs.indexOf(tab) + offset) % tabs.length]
                    setTab(next)
                    document.getElementById(`demo-tab-${next}`)?.focus()
                    event.preventDefault()
                  }
                }}
                role="tab"
                tabIndex={tab === id ? 0 : -1}
                type="button"
              >
                <Icon size={14} />{label}
              </button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="演示会话操作" size="icon-xs" variant="ghost"><MoreHorizontal size={16} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={freshChat}>新建演示会话</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setMessages([]); onNotice('演示消息已清空') }}>清空演示消息</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPanel(value => !value)}>切换资源面板</DropdownMenuItem>
              <DropdownMenuItem disabled>导出（仅正式应用可用）</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {tab === 'file' ? <DemoDocument /> : <div aria-labelledby={`demo-tab-${tab}`} className="ui-lab-demo-chat" id={`demo-panel-${tab}`} role="tabpanel">
          <div className="ui-lab-demo-messages">
            <div className="ui-lab-demo-chat-heading"><h3>{tab === 'bot' ? '设计助手' : title}</h3><span>示例会话</span></div>
            {title !== '新会话' && <><div className="ui-lab-demo-user">帮我整理一下这次桌面界面的优化重点。</div><div className="ui-lab-demo-answer"><img alt="Aino" height={25} src={ainoLogo} width={25} /><div><span className="ui-lab-demo-author">{tab === 'bot' ? '设计助手' : 'Aino'}</span><p>把细节统一，操作就会自然。建议从这三个地方开始：</p><ol><li><strong>同一套图标</strong>，保持一致的线条和视觉重量。</li><li><strong>清晰的主次操作</strong>，减少不必要的强调。</li><li><strong>连续的工作区</strong>，在标签页内查看文件与进度。</li></ol><ToolDisclosure /></div></div></>}
            {messages.map((message,index) => <div className={message.role === 'user' ? 'ui-lab-demo-user' : 'ui-lab-demo-followup'} key={index}>{message.role === 'assistant' && <img alt="Aino" height={24} src={ainoLogo} width={24} />}<span>{message.text}</span></div>)}
            {title === '新会话' && messages.length === 0 && <div className="ui-lab-demo-empty"><img alt="" height={42} src={ainoLogo} width={42} /><h3>从一个想法开始</h3><p>输入一条消息，体验输入框的交互。</p></div>}
          </div>
          <DemoComposer onSend={text => setMessages(value => [...value,{role:'user',text},{role:'assistant',text:'这是一条本地演示回复。你可以继续切换模型、查看资源，或探索其他组件。'}])} />
        </div>}
      </div>
      {panel && <DemoResources onClose={() => setPanel(false)} onFile={() => setTab('file')} />}
    </div>
    <div className="ui-lab-workbench-footer"><span><span className="ui-lab-ready-dot" />所有控件可交互</span><span>示例数据 · 不会发送模型请求</span></div>
  </section>
}

interface ToolbarActionProps { active?: boolean; label: string; name: string; onClick: () => void }

function ToolbarAction({active,label,name,onClick}: ToolbarActionProps) {
  return <Tip label={label} placement="toolbar"><Button aria-label={label} aria-pressed={active} onClick={onClick} size="icon-titlebar" variant="ghost"><WindowChromeIcon name={name} /></Button></Tip>
}

function DemoNotifications() {
  const [read,setRead] = useState(false)
  const [open,setOpen] = useState(false)

  return <Popover onOpenChange={setOpen} open={open}><Tip label="演示通知" placement="toolbar"><PopoverTrigger asChild><Button aria-label="演示通知" className="relative" size="icon-titlebar" variant="titlebar-popover"><WindowChromeIcon name="bell" />{!read && <span className="ui-lab-unread-dot" />}</Button></PopoverTrigger></Tip><PopoverContent align="end" className="ui-lab-notification-popover" showArrow={false} variant="card"><header><strong>通知与状态</strong><Button aria-label="关闭演示通知" onClick={() => setOpen(false)} size="icon-xs" variant="ghost"><X size={14} /></Button></header>{read ? <div className="ui-lab-notice-empty"><Check size={22} /><p>所有提醒都已处理</p></div> : <div className="ui-lab-notice-item"><Check size={17} /><div><strong>设计文件已准备好</strong><p>在右侧资源面板中查看设计说明。</p><span>刚刚 · 示例通知</span></div></div>}<footer><Button onClick={() => setRead(value => !value)} size="sm" variant="text">{read ? '重新显示示例提醒' : '标记为已读'}</Button></footer></PopoverContent></Popover>
}

function ToolDisclosure() {
  const [expanded,setExpanded] = useState(false)

  return <div className="ui-lab-tool-run"><button aria-expanded={expanded} className="ui-lab-tool-summary" onClick={() => setExpanded(value => !value)} type="button"><ChevronRight className={expanded ? 'ui-lab-chevron-open' : undefined} size={13} /><ToolIcon name="book-open" /><span>已探索 2 个文件，已运行 1 个命令</span><span className="ui-lab-tool-time">3 秒</span></button>{expanded && <div className="ui-lab-tool-details"><div><ToolIcon name="book-open" /><span>读取设计说明.md</span><Check size={13} /></div><div><ToolIcon name="book-open" /><span>读取组件规范.md</span><Check size={13} /></div><div><ToolIcon name="terminal" /><span>检查组件类型</span><Check size={13} /></div></div>}</div>
}

function DemoComposer({onSend}: {onSend:(text:string)=>void}) {
  const [draft,setDraft] = useState('')
  const [model,setModel] = useState('GLM-5.3-Flash')
  const [attachment,setAttachment] = useState(false)

  const submit = (event?: FormEvent) => { event?.preventDefault();

 if (!draft.trim()) {return;} onSend(draft.trim()); setDraft(''); setAttachment(false) }

  return <form className="ui-lab-demo-composer" onSubmit={submit}>{attachment && <div className="ui-lab-attachment"><FileText size={13} />设计说明.md<Button aria-label="移除示例附件" onClick={() => setAttachment(false)} size="icon-xs" type="button" variant="ghost"><X size={12} /></Button></div>}<Textarea appearance="composer" aria-label="演示消息" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} placeholder="输入消息，试试这套界面…" rows={2} value={draft} /><div className="ui-lab-composer-toolbar"><Popover><PopoverTrigger asChild><Button aria-label="添加演示附件" size="icon-xs" type="button" variant="ghost"><Plus size={16} /></Button></PopoverTrigger><PopoverContent align="start" className="w-56" showArrow={false} variant="menu"><Button onClick={() => setAttachment(true)} type="button" variant="ghost"><FileText size={15} />插入示例文件</Button></PopoverContent></Popover><div className="ui-lab-composer-end"><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label={`演示模型：${model}`} size="xs" type="button" variant="ghost">{model}<ChevronDown size={12} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>示例模型 · 不调用 API</DropdownMenuLabel><DropdownMenuRadioGroup onValueChange={setModel} value={model}>{['GLM-5.3-Flash','DeepSeek-V3.2','GPT-5.2'].map(item => <DropdownMenuRadioItem key={item} value={item}>{item}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup><DropdownMenuSeparator /><DropdownMenuItem disabled>此处的选择仅用于交互演示</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button aria-label="发送演示消息" disabled={!draft.trim()} size="icon-send" type="submit"><ArrowUp size={17} /></Button></div></div></form>
}

function DemoResources({onClose,onFile}:{onClose:()=>void;onFile:()=>void}) {
  return <aside aria-label="演示资源面板" className="ui-lab-demo-resources"><header><strong>会话资源</strong><Button aria-label="收起资源面板" onClick={onClose} size="icon-xs" variant="ghost"><X size={14} /></Button></header><h4>输出内容</h4><button onClick={onFile} type="button"><FileText size={15} /><span>设计说明.md</span><ChevronRight size={13} /></button><h4>工作环境</h4><p><Folder size={14} />Aino 设计工作区</p><span className="ui-lab-resource-note">此面板使用示例文件。<br />点击文件可在标签页中预览。</span></aside>
}

function DemoDocument() {
  return <article aria-labelledby="demo-tab-file" className="ui-lab-demo-document" id="demo-panel-file" role="tabpanel"><div><FileText size={16} />设计说明.md<span>示例文件</span></div><h3>让每一次操作都更自然</h3><p>界面的统一，来自每个细节都遵循同一套规则。</p><h4>保持一致的视觉重量</h4><p>图标采用轻量描边，文字承担主要信息。辅助按钮安静地融入工具栏，重要操作保持清晰。</p><h4>让状态及时可见</h4><p>悬停、选中、加载与错误都有明确反馈。提示以浮层呈现，不挤压正在阅读的内容。</p><div className="ui-lab-document-note"><Check size={16} />此文件仅用于组件预览，不会写入本地文件。</div></article>
}
