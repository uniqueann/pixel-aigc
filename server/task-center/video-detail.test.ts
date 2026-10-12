import { describe,expect,it } from 'vitest'
import { presentTaskDetail } from './service.js'
import { recoveryDetail,recoveryImage,recoveryOwner } from '../../src/features/task-center/recovery.fixture.js'
const storage={safe:(_owner:string,key:string)=>key.startsWith('images/'),head:async()=>({bytes:1024,contentType:'video/mp4'}),sign:async()=>({url:'https://example.invalid/signed',expiresAt:Date.now()+900000})}
describe('只读详情的视频恢复元数据',()=>{
  it('只返回原任务已保存的元数据，且过滤无归属的海报对象',async()=>{
    const source=recoveryDetail(),result=recoveryImage()
    const task={...source.task,capability:'text_to_video',resultExpiresAt:new Date(Date.now()+86400000).toISOString()}
    const value=await presentTaskDetail({task,native:{params:{prompt:'video'}},items:[{status:'succeeded',ordinal:0,result_object_key:result.objectKey,result_mime_type:'video/mp4',result_width:64,result_height:64,
      result_metadata:{durationSeconds:5,sizeBytes:1024,hasAudio:true,posterKey:'other-owner/poster'}}]},recoveryOwner,storage)
    expect(value.results[0]).toMatchObject({kind:'video',video:{durationSeconds:5,sizeBytes:1024,hasAudio:true,retentionExpiresAt:task.resultExpiresAt}})
    expect('video' in value.results[0]&&value.results[0].video?.posterKey).toBeUndefined()
  })
  it('缺失的视频元数据不补造，保留可播放结果和原执行事实',async()=>{
    const source=recoveryDetail(),result=recoveryImage()
    const task={...source.task,capability:'text_to_video'}
    const value=await presentTaskDetail({task,native:{params:{}},items:[{status:'succeeded',ordinal:0,result_object_key:result.objectKey,result_mime_type:'video/mp4',result_width:64,result_height:64,result_metadata:{}}]},recoveryOwner,storage)
    expect(value.results[0]).not.toHaveProperty('video')
    expect(value.task.state).toBe('succeeded');expect(value.task.creditsCharged).toBe(task.creditsCharged)
    expect(value.results[0]).toMatchObject({availability:'available'})
  })
})
