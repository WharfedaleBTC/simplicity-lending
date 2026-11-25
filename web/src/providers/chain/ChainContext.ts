import { createContext } from 'react'

import type { ChainContextValue } from './types'

export const CHAIN_CONTEXT_UNINITIALIZED = Symbol('CHAIN_CONTEXT_UNINITIALIZED')

export const ChainContext = createContext<ChainContextValue | typeof CHAIN_CONTEXT_UNINITIALIZED>(
  CHAIN_CONTEXT_UNINITIALIZED,
)
