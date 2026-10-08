import { createHmac, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({product:vi.fn(),checkout:vi.fn(),create:vi.fn(),payment:vi.fn()}))
vi.mock('dodopayments',async importOriginal=>{
  const actual=await importOriginal<typeof import('dodopayments')>()
  return {default:class {
    constructor(options:ConstructorParameters<typeof actual.default>[0]) {this.webhooks=new actual.default(options).webhooks}
    webhooks: InstanceType<typeof actual.default>['webhooks']
    products={retrieve:mocks.product};checkoutSessions={retrieve:mocks.checkout,create:mocks.create};payments={retrieve:mocks.payment}
  }}
})
import { configuredProviders, createPaymentCheckout, paymentMode, readPaymentReceipt, validateCheckoutUrl, validateProduct, verifyPaymentEvent, type PaymentOrderSnapshot } from './providers'
const order:PaymentOrderSnapshot={id:'00000000-0000-4000-8000-000000000111',user_id:'00000000-0000-4000-8000-000000000112',scope:'preview',provider:'dodo',provider_mode:'test',
  product_id:'prod_aigc_starter',amount:199,currency:'USD',credits:100,checkout_id:'ch_aigc'}
const metadata={productScope:'aigc',orderId:order.id,userId:order.user_id,runtimeScope:order.scope,paymentMode:'test'}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv('AIGC_RUNTIME_SCOPE','preview');vi.stubEnv('AIGC_CREDIT_CURRENCY','USD');vi.stubEnv('AIGC_PAYMENTS_ENABLED','true');vi.stubEnv('AIGC_CREEM_ENABLED','true')
  for(const p of ['CREEM','DODO']) {
    vi.stubEnv(`AIGC_${p}_TEST_API_KEY`,'test_key');vi.stubEnv(`AIGC_${p}_TEST_WEBHOOK_SECRET`,'test_secret')
    vi.stubEnv(`AIGC_${p}_TEST_STARTER_PRODUCT_ID`,order.product_id)
  }
  mocks.product.mockResolvedValue({price:{type:'one_time_price',price:199,currency:'USD',tax_inclusive:true}})
  mocks.checkout.mockResolvedValue({id:'ch_aigc',payment_id:'pay_aigc',payment_status:'succeeded'})
  mocks.payment.mockResolvedValue({payment_id:'pay_aigc',checkout_session_id:'ch_aigc',metadata,currency:'USD',total_amount:199,status:'succeeded',
    product_cart:[{product_id:order.product_id,quantity:1}],refunds:[],disputes:[]})
})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
describe('支付通道验证',()=>{
  it('测试/正式模式按运行环境隔离，人民币目录不会提供Creem',()=>{
    expect(paymentMode()).toBe('test');expect(configuredProviders('starter')).toEqual(['dodo','creem'])
    vi.stubEnv('AIGC_CREDIT_CURRENCY','CNY');expect(configuredProviders('starter')).toEqual(['dodo'])
    vi.stubEnv('AIGC_RUNTIME_SCOPE','production');expect(paymentMode()).toBe('live');expect(configuredProviders('starter')).toEqual([])
  })
  it('只允许固定含税一次性商品，拒绝订阅、折扣和任意金额',async()=>{
    await expect(validateProduct('dodo',order.product_id,199,'USD')).resolves.toBeUndefined()
    for(const price of [{type:'recurring_price'},{type:'one_time_price',price:199,currency:'USD',tax_inclusive:true,pay_what_you_want:true},
      {type:'one_time_price',price:199,currency:'USD',tax_inclusive:true,discount_bps:100}]) {
      mocks.product.mockResolvedValue({price});await expect(validateProduct('dodo',order.product_id,199,'USD')).rejects.toMatchObject({code:'PAYMENT_MISMATCH'})
    }
  })
  it('创建支付链接绑定AIGC、账号和环境，禁用币种选择及折扣',async()=>{
    mocks.create.mockResolvedValue({session_id:'ch_aigc',checkout_url:'https://checkout.dodopayments.com/abc'})
    await createPaymentCheckout(order,'user@example.com','https://aigc.example/?creditOrder=abc')
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({metadata,product_cart:[{product_id:order.product_id,quantity:1}],billing_currency:'USD',
      feature_flags:{allow_currency_selection:false,allow_discount_code:false}}))
  })
  it('到账重新查询支付平台，前端返回参数不能决定到账',async()=>{
    const receipt=await readPaymentReceipt(order)
    expect(mocks.checkout).toHaveBeenCalledWith(order.checkout_id);expect(mocks.payment).toHaveBeenCalledWith('pay_aigc')
    expect(receipt).toMatchObject({paidAmount:199,refundedAmount:0,productId:order.product_id})
    mocks.checkout.mockResolvedValue({payment_id:null});expect(await readPaymentReceipt(order)).toBeNull()
  })
  it('拒绝其他产品、账号、环境、金额、币种及订阅付款',async()=>{
    const base=await mocks.payment()
    for(const changed of [{metadata:{...metadata,productScope:'edm'}},{metadata:{...metadata,userId:'someone'}},{metadata:{...metadata,runtimeScope:'production'}},
      {total_amount:198},{currency:'CNY'},{subscription_id:'sub_edm'},{product_cart:[{product_id:'prod_edm',quantity:1}]}]) {
      mocks.payment.mockResolvedValue({...base,...changed});await expect(readPaymentReceipt(order)).rejects.toMatchObject({code:'PAYMENT_MISMATCH'})
    }
  })
  it('拒绝伪造支付域名及脚本地址',()=>{
    expect(validateCheckoutUrl('https://test-checkout.creem.io/test','creem')).toContain('creem.io')
    for(const url of ['javascript:alert(1)','https://creem.io.attacker.test/x','https://attacker.test/x']) expect(()=>validateCheckoutUrl(url,'creem')).toThrow()
  })
  it('Creem对原始字节验签，重新排版、重复头和伪造签名都拒绝',()=>{
    const body='{"eventType":"checkout.completed", "id":"evt_test"}',signature=createHmac('sha256','test_secret').update(body).digest('hex')
    expect(verifyPaymentEvent('creem',body,{'creem-signature':signature}).id).toBe('evt_test')
    expect(()=>verifyPaymentEvent('creem',JSON.stringify(JSON.parse(body)),{'creem-signature':signature})).toThrow('支付回调签名无效')
    expect(()=>verifyPaymentEvent('creem',body,{'creem-signature':[signature,signature]})).toThrow('支付回调签名无效')
    expect(()=>verifyPaymentEvent('creem',body,{'creem-signature':'0'.repeat(64)})).toThrow('支付回调签名无效')
  })
  it('Dodo按Standard Webhooks验签并拒绝过期事件',()=>{
    const key=randomBytes(32),body='{"type":"payment.succeeded","data":{}}',id='msg_1',timestamp=String(Math.floor(Date.now()/1000))
    vi.stubEnv('AIGC_DODO_TEST_WEBHOOK_SECRET',`whsec_${key.toString('base64')}`)
    const signature=`v1,${createHmac('sha256',key).update(`${id}.${timestamp}.${body}`).digest('base64')}`
    expect(verifyPaymentEvent('dodo',body,{'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signature}).type).toBe('payment.succeeded')
    expect(()=>verifyPaymentEvent('dodo',body,{'webhook-id':id,'webhook-timestamp':'1','webhook-signature':signature})).toThrow('支付回调签名无效')
  })
})
