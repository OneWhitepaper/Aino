import { Check, ChevronDown, Copy, FileText, Folder, MoreHorizontal, Plus, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToolIcon } from '@/components/ui/tool-icon'
import { Tip } from '@/components/ui/tooltip'
import { WindowChromeIcon } from '@/components/ui/window-chrome-icon'

interface SectionProps {
  onNotice: (message: string) => void
}

interface ComponentSectionsProps extends SectionProps {
  section: string
}

interface SpecimenProps {
  title: string
  description: string
  children: ReactNode
}

function Specimen({ title, description, children }: SpecimenProps) {
  return (
    <section className="ui-lab-specimen">
      <div className="ui-lab-specimen-heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="ui-lab-specimen-body">{children}</div>
    </section>
  )
}

const CHROME_ICONS = [
  { name: 'layout-sidebar-left', label: '导航栏' },
  { name: 'bell', label: '通知' },
  { name: 'hud', label: '浮动对话' },
  { name: 'list', label: '会话资源' },
  { name: 'layout-panel', label: '终端' },
  { name: 'layout-sidebar-right', label: '工具面板' }
] as const

function IconsSection({ onNotice }: SectionProps) {
  const [selected, setSelected] = useState('list')

  return (
    <div className="ui-lab-section-stack">
      <Specimen description="同一套描边、尺寸和点击区域。悬停查看名称，点击切换选中状态。" title="窗口工具栏">
        <div aria-label="图标按钮演示" className="ui-lab-toolbar-sample" role="toolbar">
          {CHROME_ICONS.map(icon => (
            <Tip key={icon.name} label={icon.label} placement="toolbar">
              <Button
                aria-expanded={selected === icon.name}
                aria-label={icon.label}
                onClick={() => setSelected(selected === icon.name ? '' : icon.name)}
                size="icon-titlebar"
                type="button"
                variant="titlebar-popover"
              >
                <WindowChromeIcon name={icon.name} />
              </Button>
            </Tip>
          ))}
        </div>
        <p className="ui-lab-helper">18px 图标 · 24px 点击区域 · 一致的圆角与悬停反馈</p>
      </Specimen>
      <Specimen description="行为图标表达正在进行的操作，文件图标表达内容类型。" title="工具与内容">
        <div className="ui-lab-component-grid">
          {[
            { name: 'book-open', label: '读取文件' },
            { name: 'edit', label: '编辑内容' },
            { name: 'terminal', label: '执行命令' },
            { name: 'tools', label: '调用工具' }
          ].map(icon => (
            <Button key={icon.name} onClick={() => onNotice(`已选择「${icon.label}」图标`)} variant="ghost">
              <ToolIcon name={icon.name} size={16} />
              {icon.label}
            </Button>
          ))}
        </div>
      </Specimen>
      <Specimen description="相同图标跟随所在组件调整尺寸，避免工具栏和正文比例失衡。" title="尺寸与层级">
        <div className="ui-lab-component-row items-end">
          {[
            { size: 14, label: '正文操作' },
            { size: 16, label: '菜单操作' },
            { size: 18, label: '窗口操作' }
          ].map(item => (
            <div className="ui-lab-icon-spec" key={item.size}>
              <WindowChromeIcon name="layout-sidebar-right" size={item.size} />
              <span>{item.label}</span>
              <small>{item.size}px</small>
            </div>
          ))}
        </div>
      </Specimen>
    </div>
  )
}

function ButtonsSection({ onNotice }: SectionProps) {
  const [busy, setBusy] = useState(false)

  return (
    <div className="ui-lab-section-stack">
      <Specimen description="主操作突出当前任务，次要操作保持安静。点击按钮体验即时反馈。" title="操作层级">
        <div className="ui-lab-component-row">
          <Button onClick={() => onNotice('已保存演示内容')}>保存更改</Button>
          <Button onClick={() => onNotice('已进入预览模式')} variant="outline">
            查看预览
          </Button>
          <Button onClick={() => onNotice('已添加到演示列表')} variant="secondary">
            <Plus strokeWidth={1.65} />
            添加项目
          </Button>
          <Button onClick={() => onNotice('已取消本次演示操作')} variant="ghost">
            取消
          </Button>
        </div>
      </Specimen>
      <Specimen description="处理中保留按钮原有尺寸，禁用状态仍然清晰可辨。" title="操作状态">
        <div className="ui-lab-component-row">
          <Button loading={busy} onClick={() => setBusy(true)}>
            保存演示
          </Button>
          <Button onClick={() => setBusy(false)} variant="outline">
            重置状态
          </Button>
          <Button disabled>不可用</Button>
          <Button disabled variant="outline">
            暂不可选
          </Button>
        </div>
        <p aria-live="polite" className="ui-lab-helper">
          {busy ? '正在演示加载状态，点击「重置状态」可恢复。' : '点击「保存演示」查看加载状态。'}
        </p>
      </Specimen>
      <Specimen description="图标与文字使用同一视觉语言；低频操作收进菜单。" title="图标操作与菜单">
        <div className="ui-lab-component-row">
          <Tip label="新建会话">
            <Button aria-label="新建会话" onClick={() => onNotice('已新建演示会话')} size="icon-sm" variant="ghost">
              <Plus strokeWidth={1.65} />
            </Button>
          </Tip>
          <Tip label="复制内容">
            <Button
              aria-label="复制内容"
              onClick={() => onNotice('已模拟复制，不会修改系统剪贴板')}
              size="icon-sm"
              variant="ghost"
            >
              <Copy strokeWidth={1.65} />
            </Button>
          </Tip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                会话操作
                <ChevronDown strokeWidth={1.65} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>当前演示会话</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onNotice('演示会话已重命名')}>重命名</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNotice('演示会话已置顶')}>置顶会话</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onNotice('演示会话已移到归档')} variant="destructive">
                归档会话
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Specimen>
    </div>
  )
}

function InputsSection({ onNotice }: SectionProps) {
  const [name, setName] = useState('产品设计助手')
  const [error, setError] = useState(false)
  const [model, setModel] = useState('glm')
  const [notes, setNotes] = useState('帮助我梳理需求，并给出清晰、可执行的建议。')
  const [enabled, setEnabled] = useState(true)
  const [checked, setChecked] = useState(true)

  return (
    <div className="ui-lab-section-stack">
      <Specimen description="标签清晰可见，错误显示在对应字段旁边。清空名称后保存可查看校验。" title="文字输入">
        <form
          className="ui-lab-form"
          onSubmit={event => {
            event.preventDefault()
            setError(!name.trim())

            if (name.trim()) {onNotice(`「${name.trim()}」已保存到演示中`)}
          }}
        >
          <label className="ui-lab-field" htmlFor="ui-lab-bot-name">
            <span>机器人名称</span>
            <Input
              aria-describedby={error ? 'ui-lab-name-error' : undefined}
              aria-invalid={error}
              id="ui-lab-bot-name"
              onChange={event => {
                setName(event.target.value)
                setError(false)
              }}
              placeholder="为机器人起个名字"
              value={name}
            />
            {error && (
              <span className="text-destructive" id="ui-lab-name-error" role="alert">
                请填写机器人名称。
              </span>
            )}
          </label>
          <label className="ui-lab-field" htmlFor="ui-lab-bot-notes">
            <span>工作说明</span>
            <Textarea id="ui-lab-bot-notes" onChange={event => setNotes(event.target.value)} rows={3} value={notes} />
          </label>
          <div className="ui-lab-component-row">
            <Button type="submit">保存配置</Button>
            <Button
              onClick={() => {
                setName('')
                setNotes('')
                setError(false)
              }}
              type="button"
              variant="ghost"
            >
              清空内容
            </Button>
          </div>
        </form>
      </Specimen>
      <Specimen description="选择即时反馈，辅助说明帮助理解当前选项。这里的模型仅用于展示。" title="选择与开关">
        <div className="ui-lab-form">
          <label className="ui-lab-field">
            <span id="ui-lab-model-label">默认模型</span>
            <Select onValueChange={setModel} value={model}>
              <SelectTrigger aria-labelledby="ui-lab-model-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="glm">GLM-5.3-Flash</SelectItem>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
                <SelectItem value="custom">自定义模型</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className="ui-lab-setting-row">
            <div>
              <label htmlFor="ui-lab-feedback">触感反馈</label>
              <p className="ui-lab-helper">在重要操作完成时给予轻量反馈</p>
            </div>
            <Switch checked={enabled} id="ui-lab-feedback" onCheckedChange={setEnabled} />
          </div>
          <label className="ui-lab-component-row justify-start" htmlFor="ui-lab-inherit">
            <Checkbox checked={checked} id="ui-lab-inherit" onCheckedChange={value => setChecked(value === true)} />
            <span>新会话继承默认模型</span>
          </label>
          <Input aria-label="禁用的输入框" disabled placeholder="此项由工作区管理" />
        </div>
      </Specimen>
    </div>
  )
}

function PanelsSection({ onNotice }: SectionProps) {
  const [open, setOpen] = useState(true)

  return (
    <div className="ui-lab-section-stack">
      <Specimen description="同一工作区中切换内容，保留明确的当前位置。支持方向键切换。" title="工作区标签页">
        <Tabs defaultValue="preview">
          <TabsList aria-label="工作区内容" size="navigation">
            <TabsTrigger size="navigation" value="preview">
              <FileText strokeWidth={1.65} />
              预览
            </TabsTrigger>
            <TabsTrigger size="navigation" value="source">
              <ToolIcon name="edit" />
              源文件
            </TabsTrigger>
            <TabsTrigger size="navigation" value="terminal">
              <ToolIcon name="terminal" />
              终端
            </TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            <div className="ui-lab-panel-content">
              <h3>产品需求.md</h3>
              <p>让会话、文件和工具在一个工作区里自然协作。</p>
              <p className="ui-lab-helper">标签页只切换展示内容，不会修改正式工作区。</p>
            </div>
          </TabsContent>
          <TabsContent value="source">
            <pre className="ui-lab-code-sample">{'# 产品需求\n\n- 清晰的导航\n- 一致的组件\n- 可预期的反馈'}</pre>
          </TabsContent>
          <TabsContent value="terminal">
            <pre className="ui-lab-code-sample">{'$ aino preview\n\n组件展示已就绪。\n这是静态输出，未执行命令。'}</pre>
          </TabsContent>
        </Tabs>
      </Specimen>
      <Specimen description="内容可收起，状态始终可见。工具执行先提供简洁摘要。" title="资源面板与展开内容">
        <div className="ui-lab-component-row justify-between">
          <div className="ui-lab-component-row">
            <Folder size={16} strokeWidth={1.65} />
            <span>项目资源</span>
            <Badge variant="muted">2</Badge>
          </div>
          <Button
            aria-controls="ui-lab-resource-content"
            aria-expanded={open}
            aria-label={open ? '收起资源' : '展开资源'}
            onClick={() => setOpen(!open)}
            size="icon-sm"
            variant="ghost"
          >
            <WindowChromeIcon name="layout-sidebar-right" />
          </Button>
        </div>
        {open && (
          <div className="ui-lab-resource-list" id="ui-lab-resource-content">
            <Button className="justify-start" onClick={() => onNotice('已打开「产品需求.md」演示预览')} variant="ghost">
              <FileText strokeWidth={1.65} />
              产品需求.md
            </Button>
            <Button className="justify-start" onClick={() => onNotice('已打开「界面规范.md」演示预览')} variant="ghost">
              <FileText strokeWidth={1.65} />
              界面规范.md
            </Button>
          </div>
        )}
        <details className="ui-lab-tool-disclosure">
          <summary>
            <ToolIcon name="book-open" />
            已探索 2 个文件
          </summary>
          <div className="ui-lab-helper">
            已读取 产品需求.md
            <br />
            已读取 界面规范.md
          </div>
        </details>
      </Specimen>
    </div>
  )
}

function FeedbackSection({ onNotice }: SectionProps) {
  const [retrySucceeded, setRetrySucceeded] = useState(false)
  const [visible, setVisible] = useState(true)
  const [removed, setRemoved] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="ui-lab-section-stack">
      <Specimen description="反馈就近出现，提供明确的恢复动作。这里的状态不会连接真实服务。" title="状态与恢复">
        <div className="ui-lab-notice-sample" role="status">
          <div>
            <strong>{retrySucceeded ? '演示连接已恢复' : '演示连接暂时中断'}</strong>
            <p>{retrySucceeded ? '可以继续刚才的操作。' : '内容已保留，恢复连接后可以继续。'}</p>
          </div>
          <Button onClick={() => setRetrySucceeded(!retrySucceeded)} size="sm" variant="outline">
            {retrySucceeded ? '重置演示' : '重试连接'}
          </Button>
        </div>
        <div className="ui-lab-component-row">
          <Badge variant="success">已完成</Badge>
          <Badge variant="warn">等待确认</Badge>
          <Badge variant="destructive">需要处理</Badge>
          <Badge variant="muted">未开始</Badge>
        </div>
      </Specimen>
      <Specimen description="提醒浮在内容之上，按需展开详情，不把正在阅读的内容向下挤。" title="通知卡片">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <WindowChromeIcon name="bell" size={16} />
              查看通知<Badge variant="muted">{visible ? '1' : '0'}</Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="p-4" showArrow={false} variant="card">
            <div className="ui-lab-component-row justify-between">
              <strong>通知与状态</strong>
              <Badge variant="muted">演示</Badge>
            </div>
            {visible ? (
              <div className="ui-lab-notice-entry">
                <h3>文件已准备好</h3>
                <p className="ui-lab-helper">「界面规范.md」可以在面板中查看。</p>
                <div className="ui-lab-component-row">
                  <Button onClick={() => onNotice('已模拟打开文件预览')} size="sm" variant="outline">
                    查看文件
                  </Button>
                  <Button onClick={() => setVisible(false)} size="sm" variant="ghost">
                    忽略
                  </Button>
                </div>
              </div>
            ) : (
              <p className="ui-lab-helper py-5">暂无待处理提醒</p>
            )}
          </PopoverContent>
        </Popover>
        <Button onClick={() => setVisible(true)} size="sm" variant="text">
          恢复演示通知
        </Button>
      </Specimen>
      <Specimen description="需要保护的操作先说明后果；可撤销的操作保留恢复入口。" title="确认与撤销">
        <div className="ui-lab-component-row">
          <span className="ui-lab-helper">{removed ? '演示会话已移除' : '设计讨论 · 演示会话'}</span>
          <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={removed} variant="outline">
                移除会话
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>移除这条演示会话？</DialogTitle>
                <DialogDescription>此操作仅影响展示页中的示例内容。移除后可以点击「撤销」恢复。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">保留会话</Button>
                </DialogClose>
                <Button
                  onClick={() => {
                    setRemoved(true)
                    setDialogOpen(false)
                    onNotice('演示会话已移除，可点击撤销恢复')
                  }}
                  variant="destructive"
                >
                  确认移除
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {removed && (
            <Button
              onClick={() => {
                setRemoved(false)
                onNotice('演示会话已恢复')
              }}
              variant="textStrong"
            >
              撤销
            </Button>
          )}
        </div>
        <div className="ui-lab-component-row">
          <Button onClick={() => onNotice('已保存，所有更改仅限本展示页')} variant="secondary">
            <Check strokeWidth={1.65} />
            显示轻提示
          </Button>
          <Tip label="操作说明会显示在控件旁，避免遮住主要内容。">
            <Button aria-label="查看操作说明" size="icon-sm" variant="ghost">
              <MoreHorizontal strokeWidth={1.65} />
            </Button>
          </Tip>
          <Button
            onClick={() => {
              setRetrySucceeded(false)
              setVisible(true)
              setRemoved(false)
              setDialogOpen(false)
              onNotice('已重置反馈演示')
            }}
            size="sm"
            variant="ghost"
          >
            <X strokeWidth={1.65} />
            重置本组
          </Button>
        </div>
      </Specimen>
    </div>
  )
}

const SECTIONS = {
  icons: IconsSection,
  buttons: ButtonsSection,
  inputs: InputsSection,
  panels: PanelsSection,
  feedback: FeedbackSection
}

export function ComponentSections({ section, onNotice }: ComponentSectionsProps) {
  const Content = Object.hasOwn(SECTIONS, section) ? SECTIONS[section as keyof typeof SECTIONS] : undefined

  return Content ? <Content onNotice={onNotice} /> : null
}
