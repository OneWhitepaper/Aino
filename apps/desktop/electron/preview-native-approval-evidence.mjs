import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Capture only the synthetic fixture while diagnosing platform input/focus ordering. */
export function traceFixtureApproval(guest, evidenceDir) {
  const records = []
  let phase = 'preparing'
  const original = guest.debugger.sendCommand
  guest.debugger.sendCommand = async function (method, ...args) {
    const result = await original.call(this, method, ...args)
    if (method === 'DOMSnapshot.captureSnapshot') {
      records.push({ phase, method, sessionId: args[1], snapshot: result })
    }
    return result
  }
  const message = (_event, method, params, sessionId) => {
    if (method.startsWith('DOM.') || method.startsWith('Page.frame') || method === 'Target.detachedFromTarget') {
      records.push({ phase, method, params, sessionId })
    }
  }
  guest.debugger.on('message', message)
  return {
    async observe(nextPhase) {
      phase = nextPhase
      const state = await guest.executeJavaScript(`({
        hover: danger.matches(':hover'), focus: document.activeElement?.id,
        focused: document.hasFocus(), opacity: getComputedStyle(danger).opacity,
        transform: getComputedStyle(danger).transform
      })`)
      records.push({ phase, state })
    },
    write(error) {
      writeFileSync(join(evidenceDir, 'sensitive-approval-failure.json'), JSON.stringify({
        platform: process.platform, error: String(error), records
      }, null, 2))
      console.error('Synthetic sensitive-approval trace:', JSON.stringify(records.map(record => {
        if (!record.snapshot) return record
        const { snapshot, ...entry } = record
        return { ...entry, documents: snapshot.documents.map(doc => ({
          frame: snapshot.strings[doc.frameId], nodes: doc.nodes.nodeName.length
        })) }
      })))
    },
    stop() {
      guest.debugger.sendCommand = original
      guest.debugger.removeListener('message', message)
    }
  }
}
