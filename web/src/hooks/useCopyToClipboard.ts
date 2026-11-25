import { useCallback, useEffect, useRef, useState } from 'react'

import { copyText } from '@/utils/clipboard'

export function useCopyToClipboard(resetDelayMs = 1500): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof window.setTimeout>>(-1)

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  const copy = useCallback(
    (text: string) => {
      void copyText(text).then(ok => {
        if (!ok) {
          console.warn('Copy to clipboard failed')
          return
        }
        setCopied(true)
        clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => setCopied(false), resetDelayMs)
      })
    },
    [resetDelayMs],
  )

  return [copied, copy]
}
