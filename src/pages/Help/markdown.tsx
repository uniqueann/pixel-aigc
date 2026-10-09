import { Fragment, type ReactNode } from 'react'
import { Typography } from 'antd'

const { Title, Paragraph, Text, Link } = Typography

/**
 * docs/help/*.md 专用的极简 markdown 渲染器。
 *
 * 只支持帮助文档实际用到的子集：`#`/`##` 标题、`-` 无序列表、
 * `|` 表格（含 `---` 分隔行）、围栏代码块、行内的 `**加粗**`、
 * `` `代码` `` 和 `[文字](链接)`。文档是随仓库维护的一手内容，
 * 新增语法时请同步扩展这里（并补测试）。
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // 按 **加粗** / `代码` / [文字](链接) 切分行内元素
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  const parts = text.split(pattern)
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Text strong key={key}>{part.slice(2, -2)}</Text>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <Text code key={key}>{part.slice(1, -1)}</Text>
    }
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (linkMatch) {
      const href = linkMatch[2]
      const external = /^https?:\/\//.test(href)
      return <Link key={key} href={href} target={external ? '_blank' : undefined} rel="noreferrer">{linkMatch[1]}</Link>
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

interface TableData {
  header: string[]
  rows: string[][]
}

function parseTable(lines: string[]): TableData | null {
  if (lines.length < 2) return null
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const header = cells(lines[0])
  const separator = cells(lines[1])
  if (!separator.every((c) => /^:?-+:?$/.test(c))) return null
  return { header, rows: lines.slice(2).map(cells) }
}

function Table({ data }: { data: TableData }) {
  return (
    <table>
      <thead>
        <tr>{data.header.map((c, i) => <th key={i}>{renderInline(c, `th-${i}`)}</th>)}</tr>
      </thead>
      <tbody>
        {data.rows.map((row, r) => (
          <tr key={r}>{row.map((c, i) => <td key={i}>{renderInline(c, `td-${r}-${i}`)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

export function Markdown({ body }: { body: string }) {
  const lines = body.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let paragraph: string[] = []

  const flushParagraph = (key: string) => {
    if (paragraph.length > 0) {
      blocks.push(<Paragraph key={key}>{renderInline(paragraph.join(' '), key)}</Paragraph>)
      paragraph = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 围栏代码块
    if (trimmed.startsWith('```')) {
      flushParagraph(`p-${blocks.length}`)
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i])
        i += 1
      }
      i += 1 // 跳过结束的 ```
      blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join('\n')}</code></pre>)
      continue
    }

    // 表格：连续的 | 行
    if (trimmed.startsWith('|')) {
      flushParagraph(`p-${blocks.length}`)
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i += 1
      }
      const table = parseTable(tableLines)
      if (table) blocks.push(<Table key={`table-${blocks.length}`} data={table} />)
      continue
    }

    // 标题
    if (trimmed.startsWith('## ')) {
      flushParagraph(`p-${blocks.length}`)
      blocks.push(<Title key={`h2-${blocks.length}`} level={4}>{renderInline(trimmed.slice(3), `h2-${blocks.length}`)}</Title>)
      i += 1
      continue
    }
    if (trimmed.startsWith('# ')) {
      flushParagraph(`p-${blocks.length}`)
      blocks.push(<Title key={`h1-${blocks.length}`} level={2} className="help-title">{renderInline(trimmed.slice(2), `h1-${blocks.length}`)}</Title>)
      i += 1
      continue
    }

    // 无序列表：连续的 - 行合成一个 <ul>
    if (trimmed.startsWith('- ')) {
      flushParagraph(`p-${blocks.length}`)
      const items: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        items.push(lines[i].trim().slice(2))
        i += 1
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {items.map((item, k) => <li key={k}>{renderInline(item, `li-${blocks.length}-${k}`)}</li>)}
        </ul>,
      )
      continue
    }

    // 空行：段落分隔
    if (trimmed === '') {
      flushParagraph(`p-${blocks.length}`)
      i += 1
      continue
    }

    // 普通文本行：并入当前段落
    paragraph.push(trimmed)
    i += 1
  }
  flushParagraph(`p-${blocks.length}`)

  return <div className="help-article">{blocks}</div>
}
