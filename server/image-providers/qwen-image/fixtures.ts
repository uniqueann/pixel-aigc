/** 形状来自千问图像异步接口文档示例。URL 与 task_id 都是假数据。 */

export const QWEN_TASK_ID = 'qwen-task-fixture-001'

export const QWEN_SUBMIT_TIME = '2026-10-06 10:00:00.000'
export const QWEN_SCHEDULED_TIME = '2026-10-06 10:00:01.200'
export const QWEN_END_TIME = '2026-10-06 10:01:12.000'

export function qwenImageUrl(index: number) {
  return `https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/qwen-fixture-${index}.png`
}

export const submitPending = {
  output: { task_id: QWEN_TASK_ID, task_status: 'PENDING' },
  request_id: 'req-submit-1',
}

export const pollPending = {
  output: { task_id: QWEN_TASK_ID, task_status: 'PENDING', submit_time: QWEN_SUBMIT_TIME },
  request_id: 'req-poll-pending',
}

export const pollRunning = {
  output: {
    task_id: QWEN_TASK_ID,
    task_status: 'RUNNING',
    submit_time: QWEN_SUBMIT_TIME,
    scheduled_time: QWEN_SCHEDULED_TIME,
  },
  request_id: 'req-poll-running',
}

export const pollUnknown = {
  output: { task_id: QWEN_TASK_ID, task_status: 'UNKNOWN' },
  request_id: 'req-poll-unknown',
}

export const pollSucceededOne = {
  output: {
    task_id: QWEN_TASK_ID,
    task_status: 'SUCCEEDED',
    submit_time: QWEN_SUBMIT_TIME,
    scheduled_time: QWEN_SCHEDULED_TIME,
    end_time: QWEN_END_TIME,
    choices: [{
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content: [{ image: qwenImageUrl(0), type: 'image' }],
      },
    }],
  },
  usage: {
    output_width: 1328,
    output_height: 1328,
    input_image_count: 0,
    input_image_type: 'qima_input_1k',
    output_image_count: 1,
    output_image_type: 'qima_output_1k',
  },
  request_id: 'req-ok',
}

export function pollSucceededContentImages(count: number) {
  return {
    output: {
      task_id: QWEN_TASK_ID,
      task_status: 'SUCCEEDED',
      submit_time: QWEN_SUBMIT_TIME,
      scheduled_time: QWEN_SCHEDULED_TIME,
      end_time: QWEN_END_TIME,
      choices: [{
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: Array.from({ length: count }, (_, index) => ({ image: qwenImageUrl(index), type: 'image' })),
        },
      }],
    },
    usage: {
      output_width: 2048,
      output_height: 2048,
      output_image_count: count,
      output_image_type: 'qima_output_2k',
    },
    request_id: 'req-multi-content',
  }
}

/** 官方异步示例只给了一张图。n>1 也可能是每个 choice 一张，这里单独覆盖。 */
export function pollSucceededChoices(count: number) {
  return {
    output: {
      task_id: QWEN_TASK_ID,
      task_status: 'SUCCEEDED',
      submit_time: QWEN_SUBMIT_TIME,
      scheduled_time: QWEN_SCHEDULED_TIME,
      end_time: QWEN_END_TIME,
      choices: Array.from({ length: count }, (_, index) => ({
        finish_reason: 'stop',
        message: { role: 'assistant', content: [{ image: qwenImageUrl(index) }] },
      })),
    },
    usage: {
      output_width: 1328,
      output_height: 1328,
      output_image_count: count,
      output_image_type: 'qima_output_1k',
    },
    request_id: 'req-multi-choices',
  }
}

/** 文档没给异步 n>1 示例。这两个形状是解析器的回退，不是已证实的响应。 */
export const pollSucceededResults = {
  output: {
    task_id: QWEN_TASK_ID,
    task_status: 'SUCCEEDED',
    results: [{ url: qwenImageUrl(0) }, { url: qwenImageUrl(1) }],
  },
  request_id: 'req-results',
}

export const pollSucceededData = {
  output: { task_id: QWEN_TASK_ID, task_status: 'SUCCEEDED' },
  data: [{ url: qwenImageUrl(0) }],
  request_id: 'req-data',
}

export const pollSucceededContentUrl = {
  output: {
    task_id: QWEN_TASK_ID,
    task_status: 'SUCCEEDED',
    choices: [{
      message: { role: 'assistant', content: [{ url: qwenImageUrl(0), type: 'image' }] },
    }],
  },
  request_id: 'req-content-url',
}

export const pollFailedModeration = {
  output: {
    task_id: QWEN_TASK_ID,
    task_status: 'FAILED',
    code: 'DataInspectionFailed',
    message: 'Input data may contain inappropriate content.',
  },
  request_id: 'req-moderation',
}

export const pollFailedInternal = {
  output: {
    task_id: QWEN_TASK_ID,
    task_status: 'FAILED',
    code: 'InternalError',
    message: 'An internal error has occurred.',
  },
  request_id: 'req-internal',
}

export const pollCanceled = {
  output: {
    task_id: QWEN_TASK_ID,
    task_status: 'CANCELED',
    message: 'task canceled',
  },
  request_id: 'req-canceled',
}

export const submitInvalidKey = {
  code: 'InvalidApiKey',
  message: 'Invalid API-key provided.',
  request_id: 'req-key',
}

export const submitThrottled = {
  code: 'Throttling.RateQuota',
  message: 'Requests rate limit exceeded.',
  request_id: 'req-throttle',
}

export const submitModeration = {
  code: 'DataInspectionFailed',
  message: 'Input data may contain inappropriate content.',
  request_id: 'req-submit-moderation',
}
