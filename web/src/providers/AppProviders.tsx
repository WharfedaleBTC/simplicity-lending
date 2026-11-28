import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import type { PropsWithChildren } from 'react'

import { env } from '@/constants/env'

import { AssetDenominationProvider } from './assetDenomination/AssetDenominationProvider'
import { ChainProvider } from './chain/ChainProvider'
import { IndexerSubscription } from './indexerEvents/IndexerSubscription'
import { PendingTransactionsProvider } from './pendingTransactions/PendingTransactionsProvider'
import { queryClient } from './queryClient'
import { TxProgressProvider } from './txProgress/TxProgressProvider'
import { WalletProvider } from './wallet/WalletProvider'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <ChainProvider>
        <WalletProvider>
          <IndexerSubscription />
          <TxProgressProvider>
            <AssetDenominationProvider>
              <PendingTransactionsProvider>{children}</PendingTransactionsProvider>
            </AssetDenominationProvider>
          </TxProgressProvider>
        </WalletProvider>
      </ChainProvider>
      {env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
