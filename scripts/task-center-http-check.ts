import assert from 'node:assert/strict'
import sharp from 'sharp'
import type { TaskCenterDetail,TaskCenterHistory,TaskCenterSidebar } from '../shared/task-center.js'

// 令牌只从进程环境读取，不写入 URL、文件或验收输出；本脚本只发送 GET。
const base=process.env.TASK_CENTER_HTTP_BASE_URL
const owners=[process.env.TASK_CENTER_PREVIEW_USER_ID,process.env.TASK_CENTER_PREVIEW_OTHER_ID]
const tokens=[process.env.TASK_CENTER_HTTP_TOKEN_A,process.env.TASK_CENTER_HTTP_TOKEN_B]
if(process.env.TASK_CENTER_HTTP_CONFIRM!=='existing_business_preview'||!base||owners.some(value=>!value)||tokens.some(value=>!value))
  throw new Error('必须指定已授权的预览地址、两个测试账号及其当前登录令牌')
const url=new URL(base)
if(url.protocol!=='https:'||!url.hostname.startsWith('pixel-aigc-')||!url.hostname.endsWith('-ningnings-projects-2ed21e15.vercel.app')||url.username||url.password||url.search)
  throw new Error('验收地址必须是指定 Vercel HTTPS 预览域名，不能携带凭据或查询参数')
assert.notEqual(owners[0],owners[1],'两个测试账号必须不同')
if(tokens.some(token=>!token||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))||
  (process.env.VERCEL_OIDC_TOKEN&&!/^[A-Za-z0-9._-]+$/.test(process.env.VERCEL_OIDC_TOKEN)))throw new Error('登录令牌格式无效，请通过环境变量提供当前会话凭据')
const requestLog:Array<{account:number;path:string;status:number}>=[]
async function request(account:number,path:string) {
  const response=await fetch(new URL(`/api${path}`,url),{headers:{Authorization:`Bearer ${tokens[account]}`,
    ...(process.env.VERCEL_OIDC_TOKEN?{'x-vercel-trusted-oidc-idp-token':process.env.VERCEL_OIDC_TOKEN}:{})},cache:'no-store',signal:AbortSignal.timeout(60000)})
  requestLog.push({account,path:path.split('?')[0],status:response.status})
  return response
}
async function json<T>(account:number,path:string):Promise<T> {
  const response=await request(account,path)
  if(!response.ok)throw new Error(`预览接口验收失败：HTTP ${response.status}，请核对部署访问与测试账号登录`)
  return await response.json() as T
}
const counts:Array<{history:number;sidebar:number}>=[]
for(let account=0;account<2;account++) {
  const me=await json<{userId:string;runtimeScope:string;features?:{taskCenter:boolean}}>(account,'/me')
  assert.equal(me.userId,owners[account],'登录账号必须与指定测试账号一致')
  assert.equal(me.runtimeScope,'preview','拒绝对生产或本地环境执行真实验收')
  assert.equal(me.features?.taskCenter,true,'预览必须启用任务中心')
  const sidebar=await json<TaskCenterSidebar>(account,'/task-center?view=sidebar')
  const history=await json<TaskCenterHistory>(account,'/task-center?view=history&state=all')
  assert.ok(sidebar.items.length<=5)
  counts.push({history:history.items.length,sidebar:sidebar.items.length})
}
const history=await json<TaskCenterHistory>(0,'/task-center?view=history&state=succeeded')
const target=history.items.find(task=>task.resultAvailability==='available')
assert.ok(target,'第一个测试账号需要有可读取的已完成预览任务')
const summary=await json<{taskKey:string}>(0,`/task-center/by-request/${target.sourceKind}/${target.requestId}`)
assert.equal(summary.taskKey,target.taskKey)
const detail=await json<TaskCenterDetail>(0,`/task-center/${target.sourceKind}/${target.sourceId}`)
const forbidden=await request(1,`/task-center/${target.sourceKind}/${target.sourceId}`)
assert.equal(forbidden.status,404,'其他账号不得读取任务详情')
const media=detail.results.find(result=>result.kind==='image'&&result.availability==='available')
let imageBytes:number|null=null
if(media&&media.kind==='image') {
  const response=await request(0,`/objects?${new URLSearchParams({key:media.objectKey})}`)
  assert.equal(response.status,200)
  const bytes=Buffer.from(await response.arrayBuffer())
  const measured=await sharp(bytes).metadata()
  assert.ok(measured.width&&measured.height,'下载字节必须是可解码的图片')
  if(media.width)assert.equal(measured.width,media.width)
  if(media.height)assert.equal(measured.height,media.height)
  imageBytes=bytes.length
}
console.log(JSON.stringify({ok:true,environment:'preview',authenticatedHTTP:true,counts,sourceKind:target.sourceKind,imageBytes,
  checks:['真实登录账号及环境核对','任务中心集合、详情及原请求查询','跨账号详情404',imageBytes?'真实对象下载及图片解码':'所选结果无图片，图片下载待另验'],
  generationPosts:0,creditsReservedByThisScript:0,requests:requestLog.length},null,2))
