export const DETECTION_CLIENT_STAGES = ['read', 'decode', 'encode', 'base64'] as const
export type DetectionClientTiming = Partial<Record<typeof DETECTION_CLIENT_STAGES[number], number>>
