import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createPlatformTokenStore } from '../../apps/desktop/electron/platform-token-store'
import { createPlatformAuth } from '../../apps/desktop/electron/platform-auth'
import { createPlatformClient } from '../../apps/desktop/electron/platform-client'

process.umask(0o077)
const option=(name:string)=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1)
if(process.argv.includes('--help')){
  console.log(`Managed Aino acceptance runner (all value options use --name=value).
Usage: electron platform-runner.cjs SCENARIO --live [options]
SCENARIO: simple | large | no_subagent | length | replay | daily | daily_replay

No account access or model run occurs without --live.
--repo=PATH                 Aino checkout (default: current working directory)
--output-root=PATH          Results root (default: system temp/aino-ultra-delegation-runs)
--fixtures=PATH             Root containing frozen large/ and small/ fixtures
--python=PATH               Python with project dependencies (default: repo .venv/venv, then python3)
--token-path=PATH           Existing encrypted platform token store (default: Aino app data)
--installation-path=PATH    Existing desktop-installation.json (default: Aino app data)
--origin=URL                Managed account origin (default: https://api.agentera.com.cn)
--name=NAME                 New run directory name
--budget=SECONDS           30..1200; simple/length 300, daily/no_subagent/daily_replay 600, large/replay 1200
--spend-target=USD          Observation threshold, >0 and <=5; settlement lag prevents a hard cap
--input-cap=TOKENS          DIAGNOSTIC ONLY: raise the cumulative-input ceiling for a headroom probe; never within-budget acceptance
--file-read-max-chars=N     Existing file read limit for a fresh isolated Aino profile; does not raise acceptance budgets
--child-compression-threshold-tokens=N Existing child compression trigger (>=16000); isolated Aino profile only
--child-reasoning-effort=high|max Existing delegation default; task overrides and parent Ultra remain unchanged
--review-skill=original|none Original requires --review-skill-path; none is a large diagnostic
--review-skill-path=PATH    External private original skill directory
--matched-comparison        Large/none diagnostic with explicit High children
--evidence-contract         Add the latest evidence JSON delivery contract to matched Aino
--independent-completions    Optional per-unit delivery diagnostic; omitted for latest batch scenario
--replay-source=PATH         Parent-only replay from an original local saved run
--legacy-replay-source=PATH  Legacy replay or daily_replay saved run
--length-source=PATH         Saved report.json for formatting-only length scenario
--driver=aino|codex          Optional native Codex comparison
--codex-bin=PATH             Native Codex executable (default: codex)
--codex-native-comparison    Required acknowledgement for live native Codex differences
--catalog-only --live        Read account/model catalog only
--settlement-only --live     Refresh saved live-* settlement receipts in output root

Offline: use harness.py without --live; see README.md. This runner is never auto-launched.`)
  process.exit(0)
}
const repo=path.resolve(option('--repo')||process.cwd())
const sourceRoot=path.join(repo,'evals/ultra_delegation')
const root=path.resolve(option('--output-root')||path.join(os.tmpdir(),'aino-ultra-delegation-runs'))
const fixtures=path.resolve(option('--fixtures')||path.join(sourceRoot,'fixtures'))
const configuredPython=option('--python')
const python=configuredPython?(configuredPython.includes(path.sep)?path.resolve(configuredPython):configuredPython):
  [path.join(repo,'.venv/bin/python'),path.join(repo,'venv/bin/python')].find(candidate=>fs.existsSync(candidate))||'python3'
const externalPathOptions=['--review-skill-path','--replay-source','--legacy-replay-source','--length-source']
const forwardedPaths=externalPathOptions.flatMap(name=>option(name)?[name+'='+path.resolve(option(name)!)]:[])
const forwardedOptions=['--name','--codex-bin','--input-cap','--file-read-max-chars','--child-compression-threshold-tokens','--child-reasoning-effort'].flatMap(name=>{
  const value=option(name)
  return value?[name+'='+(name==='--codex-bin'&&value.includes(path.sep)?path.resolve(value):value)]:[]
})
const scenario=process.argv.find(arg=>['simple','large','no_subagent','length','replay','daily','daily_replay'].includes(arg))
const driverArg=process.argv.find(arg=>arg.startsWith('--driver='))
if(driverArg && !['--driver=aino','--driver=codex'].includes(driverArg))throw new Error('Invalid acceptance driver')
if(driverArg==='--driver=codex' && scenario!=='large')throw new Error('Codex comparison requires large scenario')
const nativeComparison=process.argv.includes('--codex-native-comparison')
if(driverArg==='--driver=codex' && !nativeComparison)throw new Error('Review native tool/depth differences and pass --codex-native-comparison before a live Codex comparison')
const reviewSkillArg=process.argv.find(arg=>arg.startsWith('--review-skill='))
const replaySourceArg=process.argv.find(arg=>arg.startsWith('--replay-source='))
if(replaySourceArg && scenario!=='replay')throw new Error('Replay source requires the replay scenario')
if(reviewSkillArg && !['--review-skill=original','--review-skill=none'].includes(reviewSkillArg))throw new Error('Invalid review skill policy')
if(reviewSkillArg==='--review-skill=none' && scenario!=='large')throw new Error('Review skill diagnostic requires large scenario')
const matchedComparison=process.argv.includes('--matched-comparison')
const independentCompletions=process.argv.includes('--independent-completions')
const evidenceContract=process.argv.includes('--evidence-contract')
if(evidenceContract && (!matchedComparison || driverArg==='--driver=codex'))throw new Error('Evidence contract requires the matched Aino comparison')
if(independentCompletions && (!matchedComparison || driverArg==='--driver=codex'))throw new Error('Independent completions requires the matched Aino comparison')
const settlementOnly=process.argv.includes('--settlement-only')
const budgetArgument=process.argv.find(arg=>arg.startsWith('--budget='))
const budget=budgetArgument?Number(budgetArgument.slice('--budget='.length)):({simple:300,no_subagent:600,large:1200,length:300,replay:1200,daily:600,daily_replay:600} as Record<string,number>)[scenario||'large']
if(!Number.isInteger(budget)||budget<30||budget>1200)throw new Error('Budget must be 30..1200 seconds')
const spendArgument=process.argv.find(arg=>arg.startsWith('--spend-target='))
const observedSpendLimit=spendArgument?Number(spendArgument.slice('--spend-target='.length)):scenario==='length'||scenario==='daily_replay'?1:scenario==='replay'?2:scenario==='daily'?1.5:5
if(!Number.isFinite(observedSpendLimit)||observedSpendLimit<=0||observedSpendLimit>5)throw new Error('Spend observation target must be above 0 and at most 5 USD')
if(!scenario && !settlementOnly && !process.argv.includes('--catalog-only')) throw new Error('Pass simple, large, no_subagent, length, replay, daily, or daily_replay')
if(!process.argv.includes('--live')) throw new Error('Account access and paid runs require explicit --live')
if(!fs.existsSync(path.join(sourceRoot,'harness.py')))throw new Error('--repo must point to this Aino checkout')
fs.mkdirSync(root,{recursive:true})
app.setName('Aino')
app.setPath('userData',fs.mkdtempSync(path.join(root,'electron-profile-')))
app.dock?.hide()
app.whenReady().then(async()=>{
  const accountData=path.join(app.getPath('appData'),'Aino')
  const store=createPlatformTokenStore({filePath:path.resolve(option('--token-path')||path.join(accountData,'platform-tokens.json')),crypto:{isAvailable:()=>safeStorage.isEncryptionAvailable(),backend:()=> 'os',encrypt:v=>safeStorage.encryptString(v),decrypt:v=>safeStorage.decryptString(v)}})
  const origin=option('--origin')||'https://api.agentera.com.cn'
  const tokens=await store.load(origin)
  if(!tokens)throw new Error('No signed-in Aino account')
  const client=createPlatformClient({origin})
  const sensitive=[tokens.accessToken,tokens.refreshToken].filter(Boolean)
  const redact=(v:string)=>sensitive.reduce((s,secret)=>s.split(secret).join('[REDACTED]'),v)
  const auth=createPlatformAuth({client,now:Date.now,tokenStore:{
    ...store,
    async save(accountOrigin,next){
      sensitive.push(next.accessToken,next.refreshToken)
      return store.save(accountOrigin,next)
    }
  }})
  const account=await auth.initialize()
  if(account.phase!=='signed_in'||!account.account){
    const error=new Error('Platform authentication unavailable')
    Object.assign(error,{code:account.error?.code||account.phase})
    throw error
  }
  const profile=account.account
  console.log(JSON.stringify({stage:'account_ready',phase:account.phase}))
  const usageFor=async(sid:string)=>{
    const rows:any[]=[]
    for(let page=1;page<=10;page++){
      const r=await auth.listUsage({page,page_size:100,session_id:sid},profile.id)
      rows.push(...r.items);if(rows.length>=r.total||!r.items.length)break
    }
    return rows
  }
  const refreshSettlement=async(runDir:string)=>{
    const reportPath=path.join(runDir,'report.json')
    const report=JSON.parse(fs.readFileSync(reportPath,'utf8'))
    const sessions=[...new Set((report.billing||[]).map((b:any)=>b.session_id).filter(Boolean))] as string[]
    if(!sessions.length){console.log(JSON.stringify({stage:'settlement_skipped',reason:'No billing session in report',report:reportPath}));return}
    const rows:any[]=[]
    for(const sid of sessions)rows.push(...await usageFor(sid))
    const receipt={fetched_at:new Date().toISOString(),session_id:sessions.length===1?sessions[0]:undefined,session_ids:sessions,items:rows}
    fs.writeFileSync(path.join(runDir,'settlement.json'),redact(JSON.stringify(receipt,null,2)),{mode:0o600})
    console.log(JSON.stringify({stage:'settlement',rows:rows.length,statuses:[...new Set(rows.map(r=>r.settlement_status))],amount_usd:rows.reduce((sum,row)=>sum+Number(row.actual_cost_decimal||0),0),report:reportPath}))
  }
  if(settlementOnly){
    let failed=false
    const runs=fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name.startsWith('live-')&&fs.existsSync(path.join(root,entry.name,'report.json'))).sort((a,b)=>a.name.localeCompare(b.name))
    for(const entry of runs){
      try{await refreshSettlement(path.join(root,entry.name))}
      catch(error:any){failed=true;console.error(JSON.stringify({stage:'settlement_error',run:entry.name,code:error.code||error.name}))}
    }
    app.exit(failed?1:0);return
  }
  const catalog=await auth.models()
  const selected=catalog.find(m=>m.model==='gpt-5.6-sol' && m.state==='available')
  if(!selected)throw new Error('Requested model unavailable')
  if(process.argv.includes('--catalog-only')){console.log(JSON.stringify({stage:'catalog_only',selected}));app.exit(0);return}
  const installation=JSON.parse(fs.readFileSync(path.resolve(option('--installation-path')||path.join(accountData,'desktop-installation.json')),'utf8')).installationId
  const lease=await auth.modelLease({model_id:selected.id,device_id:installation,connection_grant_id:randomUUID()})
  if(!profile.id)throw new Error('No authenticated identity')
  console.log(JSON.stringify({stage:'catalog',model:selected.model,model_id:selected.id,expires_at:lease.expires_at,api_mode:lease.model.api_mode,prices:Object.fromEntries(Object.entries(selected).filter(([k])=>/price|cost/.test(k)))}))
  sensitive.push(lease.api_key)
  const child=spawn(python,[path.join(sourceRoot,'harness.py'),scenario!,'--live','--repo='+repo,'--output-root='+root,'--fixtures='+fixtures,...forwardedPaths,...forwardedOptions,'--budget='+budget,'--spend-target='+observedSpendLimit,...(reviewSkillArg?[reviewSkillArg]:[]),...(driverArg?[driverArg]:[]),...(nativeComparison?['--codex-native-comparison']:[]),...(matchedComparison?['--matched-comparison']:[]),...(independentCompletions?['--independent-completions']:[]),...(evidenceContract?['--evidence-contract']:[])],{cwd:root,stdio:['pipe','pipe','pipe']})
  const log=fs.openSync(path.join(root,'live-'+scenario+'-'+Date.now()+'.log'),'w',0o600)
  let runDir='';let billingSession='';let budgetStop=false
  const onLine=(line:string)=>{
    const clean=redact(line);fs.writeSync(log,clean+'\n');console.log(clean)
    try {
      const obj=JSON.parse(clean)
      if(obj.run_dir)runDir=obj.run_dir
      if(obj.stage==='billing_identity')billingSession=obj.session_id
    }catch{}
  }
  const consume=(stream:any)=>{let pending='';stream.setEncoding('utf8');stream.on('data',(s:string)=>{pending+=s;const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines)onLine(line)});stream.on('end',()=>{if(pending)onLine(pending)})}
  consume(child.stdout);consume(child.stderr)
  child.stdin.end(JSON.stringify({...lease,origin,user_id:String(profile.id)}))
  let polling=false
  const budgetTimer=setInterval(async()=>{
    if(!billingSession||polling||budgetStop)return;polling=true
    try {
      const rows=await usageFor(billingSession)
      const amount=rows.reduce((n:number,row:any)=>n+Number(row.actual_cost_decimal||row.charged_amount_usd||row.charged_amount||row.total_cost_usd||row.cost_usd||0),0)
      onLine(JSON.stringify({stage:'observed_usage',rows:rows.length,amount,precision:'settlement-lag; not a monetary hard cap'}))
      if(amount>=observedSpendLimit){budgetStop=true;onLine(JSON.stringify({stage:'observed_budget_stop',amount,observedSpendLimit}));child.kill('SIGTERM')}
    }catch(error:any){onLine(JSON.stringify({stage:'usage_poll_error',code:error.code||error.name}))}
    finally{polling=false}
  },30000)
  const watchdog=setTimeout(()=>child.kill('SIGTERM'),(budget+50)*1000)
  const hardStop=setTimeout(()=>child.kill('SIGKILL'),(budget+80)*1000)
  const exitCode=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
  clearInterval(budgetTimer);clearTimeout(watchdog);clearTimeout(hardStop)
  fs.closeSync(log)
  if(runDir && fs.existsSync(path.join(runDir,'report.json'))){
    try{await refreshSettlement(runDir)}
    catch(error:any){console.log(JSON.stringify({stage:'settlement_error',code:error.code||error.name}))}
  }
  app.exit(exitCode||0)
}).catch((error:any)=>{console.error(JSON.stringify({stage:'platform_error',code:error.code||error.name,message:'Platform run failed; no credential details emitted'}));app.exit(1)})
