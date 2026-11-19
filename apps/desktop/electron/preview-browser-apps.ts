import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'

import type { PreviewBrowserApp } from '../shared/preview-browser-apps'

import { execText } from './backend-claim'
import { writeComposerImage } from './composer-image-files'
import { composerImageBufferFromIpc } from './hardening'
import { hiddenWindowsChildOptions } from './windows-child-options'

interface BrowserDefinition {
  id: string
  name: string
  bundleId?: string
  windowsPath?: string[]
  commands?: string[]
}

// HTTPS handlers can include desktop clients that cannot open a local HTML file.
const browsers: BrowserDefinition[] = [
  {
    id: 'edge',
    name: 'Microsoft Edge',
    bundleId: 'com.microsoft.edgemac',
    windowsPath: ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    commands: ['microsoft-edge-stable', 'microsoft-edge']
  },
  { id: 'safari', name: 'Safari', bundleId: 'com.apple.Safari' },
  {
    id: 'chrome',
    name: 'Google Chrome',
    bundleId: 'com.google.Chrome',
    windowsPath: ['Google', 'Chrome', 'Application', 'chrome.exe'],
    commands: ['google-chrome-stable', 'google-chrome']
  },
  { id: 'chrome-testing', name: 'Google Chrome for Testing', bundleId: 'com.google.chrome.for.testing' },
  {
    id: 'firefox',
    name: 'Firefox',
    bundleId: 'org.mozilla.firefox',
    windowsPath: ['Mozilla Firefox', 'firefox.exe'],
    commands: ['firefox']
  },
  {
    id: 'brave',
    name: 'Brave',
    bundleId: 'com.brave.Browser',
    windowsPath: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
    commands: ['brave-browser', 'brave']
  },
  {
    id: 'opera',
    name: 'Opera',
    bundleId: 'com.operasoftware.Opera',
    windowsPath: ['Programs', 'Opera', 'launcher.exe'],
    commands: ['opera']
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    bundleId: 'com.vivaldi.Vivaldi',
    windowsPath: ['Vivaldi', 'Application', 'vivaldi.exe'],
    commands: ['vivaldi-stable', 'vivaldi']
  },
  { id: 'chromium', name: 'Chromium', bundleId: 'org.chromium.Chromium', commands: ['chromium', 'chromium-browser'] }
]

const browserIds = new Set<unknown>(browsers.map(browser => browser.id))

interface BrowserTarget {
  id: string
  name: string
  executable: string
  bundle?: string
  icon?: string
}

// Launch Services enumerates handlers without opening a page. Read icons only for
// recognized browsers when building the menu; opening only revalidates the installation.
function registeredMacBrowsersScript(includeIcons: boolean): string {
  const bundleIds = browsers.flatMap(browser => (browser.bundleId ? [browser.bundleId] : []))

  return `
ObjC.import('AppKit');
const workspace = $.NSWorkspace.sharedWorkspace;
const urls = workspace.URLsForApplicationsToOpenURL($.NSURL.URLWithString('https://example.invalid/'));
const browserIds = new Set(${JSON.stringify(bundleIds)});
function browserIcon(bundlePath) {
  try {
    const icon = workspace.iconForFile(bundlePath);
    const target = $.NSImage.alloc.initWithSize($.NSMakeSize(32, 32));
    target.lockFocus;
    try {
      icon.drawInRectFromRectOperationFraction(
        $.NSMakeRect(0, 0, 32, 32), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1
      );
    } finally {
      target.unlockFocus;
    }
    const bitmap = $.NSBitmapImageRep.imageRepWithData(target.TIFFRepresentation);
    const png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
    return ObjC.unwrap(png.base64EncodedStringWithOptions(0));
  } catch (error) {
    return undefined;
  }
}
const apps = [];
for (let i = 0; i < urls.count; i++) {
  const url = urls.objectAtIndex(i);
  const bundle = $.NSBundle.bundleWithURL(url);
  const id = ObjC.unwrap(bundle.bundleIdentifier);
  if (!browserIds.has(id)) continue;
  const bundlePath = ObjC.unwrap(url.path);
  const executable = ObjC.unwrap(bundle.executablePath);
  const icon = ${includeIcons} && browserIcon(bundlePath);
  apps.push({ bundle: bundlePath, id, executable, icon: icon || undefined });
}
JSON.stringify(apps);`
}

interface MacHandler {
  bundle: string
  id: string
  executable: string
  icon?: string
}

async function registeredMacBrowsers(includeIcons: boolean): Promise<MacHandler[]> {
  try {
    return JSON.parse(
      await execText('/usr/bin/osascript', ['-l', 'JavaScript', '-e', registeredMacBrowsersScript(includeIcons)])
    )
  } catch {
    return []
  }
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fs.constants.X_OK)

    return (await fs.stat(file)).isFile()
  } catch {
    return false
  }
}

async function findBrowserTargets(
  findOnPath: (command: string) => string | null,
  includeIcons = false
): Promise<BrowserTarget[]> {
  if (process.platform === 'darwin') {
    const targets = new Map<string, BrowserTarget>()

    for (const { bundle, id, executable, icon } of await registeredMacBrowsers(includeIcons)) {
      const definition = browsers.find(browser => browser.bundleId === id)

      if (!definition || targets.has(id) || !bundle || !executable || !path.isAbsolute(bundle)) {
        continue
      }

      const binary = path.relative(path.join(bundle, 'Contents/MacOS'), executable)

      if (!bundle.endsWith('.app') || !binary || binary === '..' || path.basename(binary) !== binary) {
        continue
      }

      if (await isExecutable(executable)) {
        targets.set(id, { id: definition.id, name: definition.name, executable, bundle, icon })
      }
    }

    return [...targets.values()]
  }

  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]

  const installed = await Promise.all(
    browsers.map(async ({ id, name, windowsPath, commands }) => {
      const candidates =
        process.platform === 'win32'
          ? windowsPath
            ? roots.filter(Boolean).map(root => path.join(root, ...windowsPath))
            : []
          : (commands ?? []).map(findOnPath)

      for (const executable of candidates) {
        if (executable && path.isAbsolute(executable) && (await isExecutable(executable))) {
          return { id, name, executable }
        }
      }

      return null
    })
  )

  return installed.filter(Boolean)
}

async function publicBrowser(target: BrowserTarget): Promise<PreviewBrowserApp> {
  const { id, name } = target

  if (target.bundle) {
    return target.icon ? { id, name, icon: `data:image/png;base64,${target.icon}` } : { id, name }
  }

  try {
    const icon = await app.getFileIcon(target.executable, { size: 'small' })

    if (!icon.isEmpty()) {
      return { id, name, icon: icon.resize({ width: 32, height: 32 }).toDataURL() }
    }
  } catch {
    // A missing icon does not make an installed browser unavailable.
  }

  return { id, name }
}

async function openArtifactInBrowser(target: BrowserTarget, file: string): Promise<void> {
  if (target.bundle) {
    await execText('/usr/bin/open', ['-a', target.bundle, file])

    return
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      target.executable,
      [pathToFileURL(file).href],
      hiddenWindowsChildOptions({
        detached: true,
        stdio: 'ignore'
      })
    )

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

async function stageArtifact(bytes: Buffer, accountUiRoot: string): Promise<string> {
  try {
    return await writeComposerImage(bytes, '.html', '', accountUiRoot)
  } catch (cause) {
    throw new Error('Could not write artifact file', { cause })
  }
}

function assertRenderer(event: IpcMainInvokeEvent): void {
  const sender = event.sender
  const owner = BrowserWindow.fromWebContents(sender)

  if (
    !owner ||
    owner.isDestroyed() ||
    owner.webContents !== sender ||
    !event.senderFrame ||
    event.senderFrame !== sender.mainFrame
  ) {
    throw new Error('unauthorized preview browser request')
  }
}

export function registerPreviewBrowserApps(
  ipc: Pick<IpcMain, 'handle'>,
  getAccountUiRoot: () => string,
  findOnPath: (command: string) => string | null
): void {
  ipc.handle('hermes:preview-browser-apps:list', async event => {
    assertRenderer(event)

    return Promise.all((await findBrowserTargets(findOnPath, true)).map(publicBrowser))
  })

  ipc.handle('hermes:preview-browser-apps:open', async (event, id: unknown, data: unknown) => {
    assertRenderer(event)

    if (!browserIds.has(id)) {
      throw new Error('The selected browser is no longer available.')
    }

    const bytes = composerImageBufferFromIpc(data)
    const accountUiRoot = getAccountUiRoot()
    const target = (await findBrowserTargets(findOnPath)).find(browser => browser.id === id)

    if (!target) {
      throw new Error('The selected browser is no longer available.')
    }

    const file = await stageArtifact(bytes, accountUiRoot)

    try {
      await openArtifactInBrowser(target, file)
    } catch (cause) {
      throw new Error('Could not open artifact in the selected browser.', { cause })
    }
  })
}
