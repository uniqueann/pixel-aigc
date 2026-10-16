import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'image-benchmark-run-')); directories.push(directory)
  const manifest = { version: 1, runId: randomUUID(), revision: 'a'.repeat(40), rounds: 1,
    cases: ['control'], targets: [{ region: 'pdx1', url: 'https://test.vercel.app' }] }
  const manifestPath = join(directory, 'manifest.json'), output = join(directory, 'results.jsonl'), calls = join(directory, 'calls')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const fakeCli = join(directory, 'cli.cjs')
  await writeFile(fakeCli, `const fs=require('node:fs'); const args=process.argv; fs.appendFileSync(process.env.BENCHMARK_TEST_CALLS,'1');
    const body=JSON.parse(args[args.indexOf('--data')+1]);
    if(process.env.BENCHMARK_TEST_FAIL) process.exit(22);
    console.log(JSON.stringify({...body,version:1,environment:'preview',region:'pdx1',revision:'a'.repeat(40),deployment:'test.vercel.app',
      configuration:'b'.repeat(64),instance:'00000000-0000-4000-8000-000000000001',instanceRequest:1,node:'v24.0.0',memoryMb:2048,
      outcome:'success',phases:{total:1},bytes:0,cleanup:'not_needed'}));`)
  const run = (extra: string[] = [], fail = false) => promisify(execFile)(process.execPath,
    ['--import', 'tsx', 'scripts/image-benchmark/run.ts', '--manifest', manifestPath, '--output', output, '--via-vercel', ...extra],
    { env: { ...process.env, IMAGE_BENCHMARK_TOKEN: 'private-test-token'.repeat(3), VERCEL_CLI_ENTRYPOINT: fakeCli,
      BENCHMARK_TEST_CALLS: calls, ...(fail ? { BENCHMARK_TEST_FAIL: '1' } : {}) } })
  return { directory, output, calls, run }
}
describe('P2-A 执行器', () => {
  it('默认仅预算；执行、报告和恢复不重复已有请求', async () => {
    const f = await fixture()
    expect((await f.run()).stdout).toContain('"execution":false')
    await expect(readFile(f.calls)).rejects.toMatchObject({ code: 'ENOENT' })
    await f.run(['--execute'])
    expect(await readFile(f.calls, 'utf8')).toBe('11')
    await f.run(['--execute', '--resume'])
    expect(await readFile(f.calls, 'utf8')).toBe('11')
    expect(await readFile(f.output + '.md', 'utf8')).toContain('1/1')
  })
  it('回执未知时保留尝试，恢复拒绝重发；错误输出不含令牌', async () => {
    const f = await fixture()
    const failed = await f.run(['--execute'], true).catch(error => error)
    expect(failed.stderr).not.toContain('private-test-token')
    expect(await readFile(f.calls, 'utf8')).toBe('1')
    await expect(f.run(['--execute', '--resume'])).rejects.toThrow()
    expect(await readFile(f.calls, 'utf8')).toBe('1')
    await f.run(['--report-only'])
    expect(await readFile(f.output + '.md', 'utf8')).toContain('0/1')
  })
})
