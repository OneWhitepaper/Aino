const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const platforms = {
  linux: { key: 'linux', directories: ['linux-unpacked', 'linux-arm64-unpacked', 'linux-armv7l-unpacked'] },
  darwin: { key: 'mac', directories: ['mac-arm64', 'mac', 'mac-universal'] },
  win32: { key: 'win', directories: ['win-unpacked', 'win-arm64-unpacked', 'win-ia32-unpacked'] },
}

function desktopBuildConfig(desktop, metadata) {
  const configPath = path.join(desktop, 'electron-builder.config.cjs')
  if (!fs.existsSync(configPath)) return metadata.build || {}
  // Source installs build their own stable identity, not the CI driver's channel.
  // A child also prevents require caches from retaining another installation's inputs.
  const env = { ...process.env }
  for (const key of ['HERMES_DESKTOP_VARIANT', 'HERMES_BUILD_COMMIT', 'HERMES_PAYLOAD_TAG',
    'HERMES_PAYLOAD_VERSION', '_HERMES_CHANNEL_REQUEST_JSON']) delete env[key]
  return JSON.parse(execFileSync(process.execPath, ['-e', `
    const config = require(process.argv[1]);
    process.stdout.write(JSON.stringify({
      executableName: config.executableName, productName: config.productName,
      extraMetadata: config.extraMetadata, directories: config.directories,
      linux: { executableName: config.linux?.executableName },
      mac: { executableName: config.mac?.executableName },
      win: { executableName: config.win?.executableName }
    }));
  `, configPath], { cwd: desktop, env, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }))
}

function desktopArtifactCandidates(installDir, platform = process.platform) {
  if (platform !== 'all' && !platforms[platform]) throw new Error(`Unsupported desktop platform: ${platform}`)
  const desktop = path.resolve(installDir, 'apps', 'desktop')
  const metadata = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'))
  const build = desktopBuildConfig(desktop, metadata)
  const effectiveMetadata = { ...metadata, ...build.extraMetadata }
  const output = path.resolve(desktop, build.directories?.output || 'dist')
  const candidates = []
  for (const [host, spec] of Object.entries(platforms)) {
    if (platform !== 'all' && platform !== host) continue
    const configuredName = build[spec.key]?.executableName ?? build.executableName
    const name = configuredName ?? (host === 'linux'
      ? effectiveMetadata.name.toLowerCase()
      : build.productName || effectiveMetadata.productName || effectiveMetadata.name)
    for (const directory of spec.directories) {
      const artifactPath = path.join(output, directory, host === 'darwin' ? `${name}.app` : host === 'win32' ? `${name}.exe` : name)
      const executablePath = host === 'darwin' ? path.join(artifactPath, 'Contents', 'MacOS', name) : artifactPath
      const resources = host === 'darwin' ? path.join(artifactPath, 'Contents', 'Resources') : path.join(path.dirname(artifactPath), 'resources')
      candidates.push({ platform: host, artifactPath, executablePath, rendererPath: path.join(resources, 'app.asar.unpacked', 'dist') })
    }
  }
  return candidates
}

function resolveDesktopArtifact(installDir, platform = process.platform) {
  const artifacts = desktopArtifactCandidates(installDir, platform).filter(({ platform: host, executablePath }) => {
    if (!fs.existsSync(executablePath)) return false
    const stat = fs.statSync(executablePath)
    return stat.isFile() && stat.size > 0 && (host === 'win32' || (stat.mode & 0o111) !== 0)
  })
  if (artifacts.length > 1) throw new Error(`expected exactly one installed desktop executable, found ${artifacts.length} in ${installDir}`)
  if (!artifacts.length) return null
  const { artifactPath, executablePath } = artifacts[0]
  return { artifactPath, executablePath }
}

function refreshPackagedLaunchSpec(spec, installDir, platform = process.platform) {
  if (spec.matchedShape !== 'packaged') return spec
  const artifact = resolveDesktopArtifact(installDir, platform)
  if (!artifact) throw new Error(`No packaged desktop artifact matches the installed package in ${installDir}`)
  return {
    ...spec,
    argv: [artifact.executablePath, ...spec.argv.slice(1)],
    cwd: spec.cwd === path.dirname(spec.argv[0]) ? path.dirname(artifact.executablePath) : spec.cwd,
  }
}

function captureUpdatedDesktopLaunch({ hermesPath, installDir, captureDir, specPath, env }) {
  fs.rmSync(specPath, { force: true })
  fs.rmSync(`${specPath}.captured`, { force: true })
  // The real CLI prepares the rebuilt sandbox helper before its final spawn.
  // Intercept only that spawn; do not replay pre-update launch assumptions.
  execFileSync(hermesPath, ['desktop', '--skip-build'], {
    cwd: installDir,
    env: {
      ...env,
      PYTHONPATH: [captureDir, env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      HERMES_E2E_CAPTURE_LAUNCH: specPath,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: 5 * 60 * 1000,
  })
  if (!fs.existsSync(`${specPath}.captured`)) {
    throw new Error('updated hermes desktop exited successfully but no launch was captured')
  }
  return JSON.parse(fs.readFileSync(specPath, 'utf8'))
}

module.exports = { desktopArtifactCandidates, resolveDesktopArtifact, refreshPackagedLaunchSpec, captureUpdatedDesktopLaunch }

if (require.main === module) {
  const [installDir, platform = process.platform, field = 'artifact'] = process.argv.slice(2)
  try {
    if (field === 'candidates') {
      console.log(JSON.stringify(desktopArtifactCandidates(installDir, platform)))
    } else {
      const result = resolveDesktopArtifact(installDir, platform)
      if (!result) throw new Error(`No packaged desktop artifact matches the installed package in ${installDir}`)
      console.log(field === 'executable' ? result.executablePath : result.artifactPath)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
