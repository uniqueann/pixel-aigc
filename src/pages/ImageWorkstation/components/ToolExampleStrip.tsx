import type { ToolExample } from '@/features/image-workstation/tools/examples'

/** 放在上传区顶部：处理前和结果并排，下面才是用户自己的上传控件。 */
export default function ToolExampleStrip({ example }: { example: ToolExample }) {
  return (
    <div className="upload-example">
      <div className="upload-example-before">
        {example.before.map((frame) => (
          <figure key={frame.src}>
            <img src={frame.src} alt={frame.alt} width={112} height={112} />
            <figcaption>{frame.caption}</figcaption>
          </figure>
        ))}
      </div>
      <span className="upload-example-arrow" aria-hidden="true">→</span>
      <figure>
        <img src={example.after.src} alt={example.after.alt} width={112} height={112} />
        <figcaption>{example.after.caption}</figcaption>
      </figure>
    </div>
  )
}
