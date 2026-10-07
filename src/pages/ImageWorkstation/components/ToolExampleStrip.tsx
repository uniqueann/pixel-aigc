import type { ToolExample } from '@/features/image-workstation/tools/examples'

export default function ToolExampleStrip({ example }: { example: ToolExample }) {
  return (
    <details className="tool-example" open>
      <summary>示例</summary>
      <div className="tool-example-row">
        <div className="tool-example-group">
          {example.before.map((frame) => (
            <figure key={frame.src}>
              <img src={frame.src} alt={frame.alt} width={112} height={112} />
              <figcaption>{frame.caption}</figcaption>
            </figure>
          ))}
        </div>
        <span className="tool-example-arrow" aria-hidden="true">→</span>
        <figure>
          <img src={example.after.src} alt={example.after.alt} width={112} height={112} />
          <figcaption>{example.after.caption}</figcaption>
        </figure>
      </div>
    </details>
  )
}
