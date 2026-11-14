import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

interface FileIdentity {
  path: string
  size: number
  modified: number
  ino: number
}
interface UploadGrant {
  files: FileIdentity[]
  expires: number
  generation: number
}
export interface DownloadGrant {
  path: string
  expires: number
  generation: number
  parentIno: number
  parentDev: number
}

/** Exact, expiring file grants; approving a folder is never implicit permission to upload it. */
export class PreviewBrowserFiles {
  private uploads = new Map<string, UploadGrant>()
  private downloads = new Map<string, DownloadGrant>()

  async prepareUpload(paths: unknown, generation: number) {
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > 32) {
      throw new Error('Choose between one and 32 local files to upload')
    }

    const files = await Promise.all(
      paths.map(async value => {
        if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
          throw new Error('Upload paths must be absolute paths on this computer')
        }

        const resolved = await fs.realpath(value)
        const stat = await fs.stat(resolved)

        if (!stat.isFile()) {
          throw new Error('Only regular files can be uploaded')
        }

        return { path: resolved, size: stat.size, modified: stat.mtimeMs, ino: stat.ino }
      })
    )

    const ticket = randomUUID()
    this.uploads.set(ticket, { files, generation, expires: Date.now() + 120_000 })

    return { ticket, paths: files.map(file => file.path), filenames: files.map(file => path.basename(file.path)) }
  }

  async consumeUpload(ticket: string, generation: number): Promise<string[]> {
    const grant = this.uploads.get(ticket)
    this.uploads.delete(ticket)

    if (!grant || grant.generation !== generation || Date.now() >= grant.expires) {
      throw new Error('Upload authorization expired or the page changed')
    }

    for (const file of grant.files) {
      const stat = await fs.stat(file.path)

      if (!stat.isFile() || stat.size !== file.size || stat.mtimeMs !== file.modified || stat.ino !== file.ino) {
        throw new Error('An upload file changed after it was approved. Select and approve it again.')
      }
    }

    return grant.files.map(file => file.path)
  }

  async prepareDownload(value: unknown, generation: number) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
      throw new Error('Download destination must be an absolute file path on this computer')
    }

    const resolved = path.join(await fs.realpath(path.dirname(value)), path.basename(value))
    const parent = await fs.stat(path.dirname(resolved))

    try {
      await fs.lstat(resolved)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }

      const ticket = randomUUID()
      this.downloads.set(ticket, {
        path: resolved,
        generation,
        expires: Date.now() + 120_000,
        parentIno: parent.ino,
        parentDev: parent.dev
      })

      return { ticket, path: resolved }
    }

    throw new Error('Download destination already exists. Choose a new filename.')
  }

  consumeDownload(ticket: string, generation: number): DownloadGrant {
    const grant = this.downloads.get(ticket)
    this.downloads.delete(ticket)

    if (!grant || grant.generation !== generation || Date.now() >= grant.expires) {
      throw new Error('Download authorization expired or the page changed')
    }

    return grant
  }

  cancelUpload(ticket: string): void {
    this.uploads.delete(ticket)
  }

  clear(): void {
    this.uploads.clear()
    this.downloads.clear()
  }
}
