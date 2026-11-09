/** Real PostgreSQL consumer scenario for legacy oversized conflict preparations. */
import { randomUUID } from 'node:crypto'

import type { SyncExchange, SyncResponse } from '../shared/platform-sync-contract'

import { createAccountCloudSync, type LocalSyncCall } from './account-cloud-sync'
import type { AccountWorkspace } from './account-workspace'

interface RecoveryInputs {
  a: AccountWorkspace
  b: AccountWorkspace
  auth: Parameters<typeof createAccountCloudSync>[0]['auth']
  local: LocalSyncCall
  run(home: AccountWorkspace, script: string): string
  settle(home: AccountWorkspace): Promise<void>
  fault: { dropRebatch: boolean; dropped: number }
}

export async function recoverLargeConflicts({ a, b, auth, local, run, settle, fault }: RecoveryInputs) {
  run(
    a,
    "for i in range(3):\n db.create_session(f'large-{i}','cli',model='fixture')\n db.append_message(f'large-{i}','user',f'base-{i}')"
  )
  await settle(a)
  await settle(b)
  run(a, "for i in range(3): db.append_message(f'large-{i}','user',f'OFFLINE_LARGE_{i}')")
  const signal = new AbortController().signal
  await local(a, { action: 'prepare', request_id: randomUUID() }, signal)
  const old = JSON.parse(
    run(
      a,
      "from hermes_cli.cloud_sync_engine import STATE_KEY\nfrom hermes_state_cloud_sync import get_meta,put_meta\ndef legacy(conn):\n s=get_meta(conn,STATE_KEY)\n s['preparation']['exchange']['operations']=list(reversed(s['outbox']))\n put_meta(conn,STATE_KEY,s)\n return s['preparation']\nprint(json.dumps(db._execute_write(legacy)))"
    )
  ) as { request_id: string; exchange: SyncExchange }

  if (old.exchange.operations.length !== 3) {
    throw new Error('legacy_batch_fixture_mismatch')
  }
  run(
    b,
    "for i in range(3):\n db.append_message(f'large-{i}','assistant','X'*(3*1024*1024))\n db.publish_compression_child(parent_session_id=f'large-{i}',child_session_id=f'large-tip-{i}',source='cli',messages=[{'role':'user','content':'Y'*(3*1024*1024)}],require_compression_lease=False)"
  )
  await settle(b)
  const seen = new Map<string, { request: SyncExchange; result: SyncResponse['results'][number] }>()

  const recoveryAuth = {
    ...auth,
    async syncExchange(...args: Parameters<typeof auth.syncExchange>) {
      const response = await auth.syncExchange(...args)

      for (const result of response.results) {
        if (old.exchange.operations.some(op => op.operation_id === result.operation_id)) {
          seen.set(result.operation_id, { request: args[0], result })
        }
      }

      return response
    }
  }

  let crashAfterRebatch = true

  const interruptedLocal: LocalSyncCall = async (...args) => {
    const result = await local(...args)

    if (args[1].action === 'rebatch' && crashAfterRebatch) {
      crashAfterRebatch = false
      throw new Error('network_recovery_restart')
    }

    return result
  }

  let coordinator = createAccountCloudSync({
    auth: recoveryAuth,
    local: interruptedLocal,
    deviceId: () => 'native-consumer-fixture'
  })

  try {
    fault.dropRebatch = true
    coordinator.start(a)
    await coordinator.retry()

    if (coordinator.snapshot().state !== 'offline' || fault.dropped !== 1) {
      throw new Error('rebatch_error_loss_not_exercised')
    }
    const retry = await local(a, { action: 'prepare', request_id: randomUUID() }, signal)

    if (retry.request_id !== old.request_id || JSON.stringify(retry.exchange) !== JSON.stringify(old.exchange)) {
      throw new Error('rejected_batch_changed_before_recovery')
    }
    await coordinator.retry()

    if (coordinator.snapshot().error !== 'network_recovery_restart') {
      throw new Error('recovery_restart_not_exercised')
    }
    await coordinator.stop()
    const recovered = await local(a, { action: 'prepare', request_id: randomUUID() }, signal)

    if (
      recovered.request_id === old.request_id ||
      JSON.stringify(recovered.exchange?.operations) !== JSON.stringify(old.exchange.operations.slice(0, 1))
    ) {
      throw new Error('recovery_changed_operation_identity')
    }
    let interruptedApply = false
    let applyEvidence: unknown = null
    let receivedPendingOperation = false

    const applyThenRestart: LocalSyncCall = async (...args) => {
      const result = await local(...args)

      if (args[1].action === 'apply' && !interruptedApply) {
        interruptedApply = true

        receivedPendingOperation = (args[1].response as SyncResponse).changes.some(record =>
          old.exchange.operations.slice(1).some(operation => operation.key === record.key)
        )
        applyEvidence = {
          changed: result.changed_session_ids,
          response: (args[1].response as SyncResponse).changes.map(r => r.key),
          op: old.exchange.operations[0].key,
          issues: result.status.issues
        }
        throw new Error('network_apply_restart')
      }

      return result
    }

    coordinator = createAccountCloudSync({
      auth: recoveryAuth,
      local: applyThenRestart,
      deviceId: () => 'native-consumer-fixture'
    })
    coordinator.start(a)
    await coordinator.retry()

    if (coordinator.snapshot().error !== 'network_apply_restart') {
      throw new Error(`apply_restart_not_exercised_${coordinator.snapshot().error}`)
    }
    await coordinator.stop()

    if (!receivedPendingOperation) {
      throw new Error(`pending_operations_not_received_in_feed_${JSON.stringify(applyEvidence)}`)
    }
    coordinator = createAccountCloudSync({ auth: recoveryAuth, local, deviceId: () => 'native-consumer-fixture' })
    coordinator.start(a)

    for (let attempt = 0; attempt < 24; attempt++) {
      await coordinator.retry()

      if (coordinator.snapshot().state !== 'pending') {
        break
      }
    }

    if (coordinator.snapshot().state !== 'synced' || seen.size !== 3) {
      throw new Error(`recovery_not_complete_${coordinator.snapshot().error}`)
    }
    const preserved = Number(
      run(
        a,
        'print(sum(db._conn.execute("SELECT count(*) FROM messages WHERE content=?",(f\'OFFLINE_LARGE_{i}\',)).fetchone()[0] == 1 for i in range(3)))'
      )
    )

    if (preserved !== 3) {
      throw new Error('recovery_lost_or_duplicated_offline_work')
    }

    for (const { request, result } of seen.values()) {
      const replay = await auth.syncExchange(
        request,
        { expected_user_id: a.userId!, expected_generation: auth.generation() },
        signal
      )

      if (JSON.stringify(replay.results[0]) !== JSON.stringify(result)) {
        throw new Error('recovery_changed_exact_receipt')
      }
    }

    // Unrelated work must proceed after the formerly wedged preparation.
    run(
      a,
      "db.create_session('after-recovery','cli',model='fixture')\ndb.append_message('after-recovery','user','AFTER_RECOVERY')"
    )
    await coordinator.stop()
    await settle(a)

    return preserved
  } finally {
    await coordinator.stop()
  }
}
