import { useContext } from 'react'

import { CHAIN_CONTEXT_UNINITIALIZED, ChainContext } from './ChainContext'
import type { ChainContextValue } from './types'

export function useChain(): ChainContextValue {
  const ctx = useContext(ChainContext)
  if (ctx === CHAIN_CONTEXT_UNINITIALIZED) {
    throw new Error('useChain() must be used within <ChainProvider />')
  }
  return ctx
}
