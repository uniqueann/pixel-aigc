import { useCallback, useRef, useState } from 'react'

type Owner = 'single' | 'batch'

/** 两种模式共享提交锁，提交前立即占用，避免保存修改稿期间出现竞争。 */
export function useEmailGenerationGate() {
  const ownerRef = useRef<Owner>()
  const [owner, setOwner] = useState<Owner>()
  const acquire = useCallback((nextOwner: Owner) => {
    if (ownerRef.current) return ownerRef.current === 'batch' && nextOwner === 'batch'
    ownerRef.current = nextOwner
    setOwner(nextOwner)
    return true
  }, [])
  const release = useCallback((currentOwner: Owner) => {
    if (ownerRef.current !== currentOwner) return
    ownerRef.current = undefined
    setOwner(undefined)
  }, [])
  return { owner, acquire, release }
}

export type EmailGenerationGate = ReturnType<typeof useEmailGenerationGate>
