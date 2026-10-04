import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { EMAIL_BATCH_HEADERS, EMAIL_BATCH_MAX_BYTES } from '../options'
import { createEmailBatchTemplate, exportEmailBatchCsv, formatEmailOperation, parseEmailBatchCsv, readEmailBatchFile } from './csv'

const defaults = { operation: 'reply', language: 'zh', polishStyles: ['clear'] } as const
const preferences = { ...defaults, polishStyles: [...defaults.polishStyles] }
const csv = (records: string[][], headers: string[] = [...EMAIL_BATCH_HEADERS]) => Papa.unparse({ fields: headers, data: records })

describe('邮件批量 CSV', () => {
  it('下载模板只有准确的四列表头，使用 UTF-8 BOM', () => {
    const template = createEmailBatchTemplate()
    expect(template.startsWith('\uFEFF')).toBe(true)
    const parsed = Papa.parse<string[]>(template, { skipEmptyLines: true })
    expect(parsed.data).toEqual([[...EMAIL_BATCH_HEADERS]])
  })

  it('保留多行正文、逗号和引号，按导入时的个人默认值生成', () => {
    const source = '客户说："请确认,发货时间"\n订单：00123'
    const rows = parseEmailBatchCsv('\uFEFF' + csv([[source, '', '', '']]), preferences)
    preferences.operation = 'reply'
    expect(rows[0]).toMatchObject({ status: 'pending', recordNumber: 2, params: { sourceText: source, operation: 'reply', language: 'zh' } })
    expect(rows[0].original['原始邮件内容']).toBe(source)
  })

  it('支持调换列顺序，忽略额外列，清理表头空白', () => {
    const rows = parseEmailBatchCsv(csv([['en', '额外值', '总结', '客户邮件', '重点日期']], ['语言', '备注', '生成设置', ' 原始邮件内容 ', '编写指导']), preferences)
    expect(rows[0].params).toEqual({ sourceText: '客户邮件', instruction: '重点日期', operation: 'summarize', language: 'en' })
  })

  it('支持润色方式组合、去重和语言代码', () => {
    const rows = parseEmailBatchCsv(csv([['邮件正文', '', '润色：提升表达清晰度+缩短+缩短', 'JA']]), preferences)
    expect(rows[0].params).toMatchObject({ operation: 'polish', polishStyles: ['clear', 'shorten'], language: 'ja' })
    expect(formatEmailOperation(rows[0].params!)).toBe('润色：提升表达清晰度+缩短')
  })

  it('未指定润色方式时使用个人默认，并对空默认使用现有清晰度回退', () => {
    const rows = parseEmailBatchCsv(csv([['邮件正文', '', '润色', '英语']]), { ...preferences, polishStyles: ['simplify'] })
    expect(rows[0].params?.polishStyles).toEqual(['simplify'])
    expect(formatEmailOperation({ sourceText: '正文', operation: 'polish', language: 'zh', polishStyles: [] })).toBe('润色：提升表达清晰度')
  })

  it.each([
    [['', '指导', '回复', '中文'], '原始邮件内容不能为空'],
    [['正文', '', '翻译', '中文'], '生成设置须为'],
    [['正文', '', '回复：缩短', '中文'], '只有润色'],
    [['正文', '', '润色：', '中文'], '润色方式请填写'],
    [['正文', '', '润色：正式', '中文'], '润色方式支持'],
    [['正文', '', '回复', '法语'], '语言须为'],
    [['字'.repeat(10001), '', '回复', '中文'], '10,000'],
    [['正文', '字'.repeat(1001), '回复', '中文'], '1,000'],
  ])('保留错误行并继续校验其他行：%s', (invalid, hint) => {
    const rows = parseEmailBatchCsv(csv([invalid, ['有效邮件', '', '检查语法', '日语']]), preferences)
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].errorMessage).toContain(hint)
    expect(rows[1].status).toBe('pending')
  })

  it('拒绝缺列、重复列、引号结构错误和空模板', () => {
    expect(() => parseEmailBatchCsv(csv([['正文']], ['原始邮件内容']), preferences)).toThrow('CSV 缺少列')
    expect(() => parseEmailBatchCsv(csv([], [...EMAIL_BATCH_HEADERS, '语言']), preferences)).toThrow('列名不能重复')
    expect(() => parseEmailBatchCsv(EMAIL_BATCH_HEADERS.join(',') + '\n"未闭合,指导,回复,中文', preferences)).toThrow('CSV 格式错误')
    expect(() => parseEmailBatchCsv(createEmailBatchTemplate(), preferences)).toThrow('没有邮件内容')
  })

  it('跳过空记录，保留 CSV 记录行号，列数错误按行标记', () => {
    const text = EMAIL_BATCH_HEADERS.join(',') + '\n,,,\n正文,指导,回复,中文\n多列,指导,回复,中文,额外值'
    const rows = parseEmailBatchCsv(text, preferences)
    expect(rows).toHaveLength(2)
    expect(rows[0].recordNumber).toBe(3)
    expect(rows[1]).toMatchObject({ recordNumber: 4, status: 'invalid' })
  })

  it('接受 50 条，拒绝 51 条，错误行也计入上限', () => {
    const records = Array.from({ length: 50 }, (_, i) => [`邮件${i}`, '', '回复', '中文'])
    expect(parseEmailBatchCsv(csv(records), preferences)).toHaveLength(50)
    expect(() => parseEmailBatchCsv(csv([...records, ['', '指导', '', '']]), preferences)).toThrow('最多 50 条')
  })

  it('结果导出保留所有行和原始四列，转义多行、引号及公式', () => {
    const rows = parseEmailBatchCsv(csv([['=客户内容', '指导', '回复', '中文'], ['', '缺少正文', '', '']]), preferences)
    rows[0] = { ...rows[0], status: 'succeeded', resultText: '回复,"谢谢"\n第二段' }
    const output = exportEmailBatchCsv(rows)
    expect(output.startsWith('\uFEFF')).toBe(true)
    const parsed = Papa.parse<string[]>(output, { skipEmptyLines: true }).data
    expect(parsed[0]).toEqual([...EMAIL_BATCH_HEADERS, '生成结果', '状态', '错误信息'])
    expect(parsed[1]).toEqual(["'=客户内容", '指导', '回复', '中文', '回复,"谢谢"\n第二段', '成功', ''])
    expect(parsed[2].slice(-2)).toEqual(['填写错误', '原始邮件内容不能为空'])
  })

  it('限制文件类型、大小和 UTF-8 编码', async () => {
    const file = (name: string, bytes: Uint8Array, size = bytes.byteLength) => ({ name, size, arrayBuffer: async () => bytes.buffer }) as File
    await expect(readEmailBatchFile(file('邮件.xlsx', new Uint8Array()), preferences)).rejects.toThrow('CSV 文件')
    await expect(readEmailBatchFile(file('邮件.csv', new Uint8Array(), EMAIL_BATCH_MAX_BYTES + 1), preferences)).rejects.toThrow('5 MB')
    await expect(readEmailBatchFile(file('邮件.csv', new Uint8Array([0xff, 0xfe])), preferences)).rejects.toThrow('CSV UTF-8')
    const rows = await readEmailBatchFile(file('邮件.CSV', new TextEncoder().encode(csv([['中文邮件', '', '', '']]))), preferences)
    expect(rows[0].params?.sourceText).toBe('中文邮件')
  })
})
