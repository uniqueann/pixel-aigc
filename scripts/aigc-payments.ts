import postgres from 'postgres'
import { z } from 'zod'

const url=process.env.AIGC_ADMIN_DATABASE_URL
if(!url) throw new Error('请在本地配置迁移管理员连接 AIGC_ADMIN_DATABASE_URL；不得用于线上 API')
const sql=postgres(url,{prepare:false,max:1,ssl:process.env.AIGC_DB_LOCAL === 'true' ? false : 'require'})
const [command,scope,...args]=process.argv.slice(2)
try {
  z.enum(['local','preview','production']).parse(scope)
  if(command === 'refunds') {
    const rows=await sql`select id,user_id,provider,pack_id,amount,currency,credits,paid_amount,refunded_amount,revoked_credits,refund_held_credits,
      refund_requested_at,refund_reason from aigc.credit_orders where scope=${scope} and refund_requested order by refund_requested_at desc limit 100`
    console.log(JSON.stringify(rows,null,2))
  } else if(command === 'prepare-refund') {
    const [id,cash,key,...reasonParts]=args,reason=reasonParts.join(' ').trim(),operator=process.env.AIGC_ADMIN_OPERATOR?.trim()
    z.uuid().parse(id)
    const amount=z.coerce.number().int().positive().parse(cash)
    if(!key || !reason || !operator) throw new Error('需要幂等键、审核原因和 AIGC_ADMIN_OPERATOR')
    const [result]=await sql`select aigc.prepare_cash_refund(${id},${scope},${amount},${key},${operator!},${reason}) as held`
    console.log(`已冻结 ${Number(result.held)} 积分；请到原支付平台人工退款。金额单位为分/美分，参数是累计退款金额。现金尚未退还。`)
  } else if(command === 'cancel-refund') {
    const [key,verified,...reasonParts]=args,reason=reasonParts.join(' ').trim(),operator=process.env.AIGC_ADMIN_OPERATOR?.trim()
    if(!key || verified!=='--verified-no-cash-refund' || !reason || !operator) throw new Error('需要审核幂等键、--verified-no-cash-refund、操作人和核验原因；先核对支付平台没有已完成或进行中的退款')
    const [result]=await sql`select aigc.cancel_cash_refund(${key},${scope},${operator!},${reason}) as released`
    console.log(`已释放 ${Number(result.released)} 积分；取消记录已保存。`)
  } else throw new Error('用法：aigc:payments refunds 环境；或 prepare-refund 环境 订单UUID 累计退款分值 幂等键 审核原因')
} finally {await sql.end()}
