/** P0 实测响应形状。token 与 task_id 均为假数据，禁止填入真实密钥或带 token 的线上 URL。 */

export const FAKE_TASK_ID = 'task_p0_fixture_001'
export const FAKE_MEDIA_TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef'
export const FAKE_MEDIA_URL = `https://dragoncode.codes/gpt-image/media/${FAKE_TASK_ID}/0?token=${FAKE_MEDIA_TOKEN}`

export const submitSuccess = {
  code: 200,
  data: [{ status: 'submitted', task_id: FAKE_TASK_ID }],
}

export const pollPending = {
  code: 200,
  data: {
    status: 'pending',
    progress: 0,
    estimated_time: 100,
    actual_time: 0,
    created: 1_759_030_000,
    completed: null,
    cost: 0,
    credits_cost: 0,
  },
}

export const pollPendingProgress5 = {
  code: 200,
  data: {
    ...pollPending.data,
    progress: 5,
  },
}

export const pollProcessing = {
  code: 200,
  data: {
    status: 'processing',
    progress: 50,
    estimated_time: 100,
    actual_time: 12,
    created: 1_759_030_000,
    completed: null,
    cost: 0,
    credits_cost: 0,
  },
}

export const pollCompleted1k = {
  code: 200,
  data: {
    status: 'completed',
    progress: 100,
    estimated_time: 100,
    actual_time: 36,
    created: 1_759_030_000,
    completed: 1_759_030_036,
    cost: 0.0085,
    credits_cost: 1,
    expires_at: 1_759_116_436,
    result: {
      images: [{ url: [FAKE_MEDIA_URL] }],
    },
  },
}

export const pollCompleted2k = {
  code: 200,
  data: {
    ...pollCompleted1k.data,
    cost: 0.014,
    actual_time: 33,
  },
}

export const pollCompleted4k = {
  code: 200,
  data: {
    ...pollCompleted1k.data,
    cost: 0.021,
    actual_time: 44,
  },
}

export const pollFailedUpstream = {
  code: 200,
  data: {
    status: 'failed',
    progress: 100,
    estimated_time: 100,
    actual_time: 18,
    created: 1_759_030_000,
    completed: 1_759_030_018,
    cost: 0,
    credits_cost: 0,
    error: {
      code: 'task_failed',
      type: 'task_failed',
      message: 'upstream_error: chatgpt upstream 400 Your request was rejected as a result of a safety check. raw dump {"id":"chatcmpl-secret"}',
    },
  },
}

export const pollFailedUnsupportedMime = {
  code: 200,
  data: {
    status: 'failed',
    progress: 100,
    estimated_time: 100,
    actual_time: 20,
    created: 1_759_030_000,
    completed: 1_759_030_020,
    cost: 0,
    credits_cost: 0,
    error: {
      code: 'task_failed',
      type: 'task_failed',
      message: 'upstream_error: chatgpt upstream 400 unsupported MIME type text/plain',
    },
  },
}

export const authApiKeyRequired = {
  code: 'API_KEY_REQUIRED',
  message: 'API key required',
}

export const authInvalidApiKey = {
  code: 'INVALID_API_KEY',
  message: 'Invalid API key',
}

export const validationNNotOne = {
  error: {
    message: 'only supports n=1',
    type: 'invalid_request_error',
    code: 'invalid_n',
    param: 'n',
  },
}

export const validationWrongModel = {
  error: {
    message: 'model must be gpt-image-2',
    type: 'invalid_request_error',
    param: 'model',
  },
}

export const validationInvalidSize = {
  error: {
    message: 'invalid size',
    type: 'invalid_request_error',
    param: 'size',
  },
}

export const validationMissingPrompt = {
  error: {
    message: 'missing prompt',
    type: 'invalid_request_error',
    param: 'prompt',
  },
}

export const validationUnreachableImage = {
  error: {
    message: 'invalid image_urls[0]: dns resolution failed',
    type: 'invalid_request_error',
    param: 'image_urls',
  },
}

export const validationDataUriTooLarge = {
  error: {
    message: 'data URI image exceeds max 20971520 bytes',
    type: 'invalid_request_error',
    param: 'image_urls',
  },
}

export const taskNotFound = {
  error: {
    message: 'GPT-Image task not found',
    type: 'not_found_error',
  },
}

export const observedPixels = {
  '1k:1:1': { width: 1254, height: 1254 },
  '1k:3:2': { width: 1536, height: 1024 },
  '1k:3:4': { width: 1086, height: 1448 },
  '2k:16:9': { width: 2048, height: 1152 },
  '4k:16:9': { width: 3840, height: 2161 },
} as const
