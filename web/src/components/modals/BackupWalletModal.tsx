import { useState } from 'react'

import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { RecoveryPhraseActions, RecoveryPhraseWords } from '@/components/RecoveryPhraseBackup'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useWallet } from '@/providers/wallet/useWallet'

interface BackupWalletModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

/** The connected wallet's recovery phrase, revealed on request, and its key file. */
export function BackupWalletModal({ isOpen, onOpenChange }: BackupWalletModalProps) {
  const { recoveryPhrase } = useWallet()
  const [revealed, setRevealed] = useState(false)
  const [wasOpen, setWasOpen] = useState(isOpen)

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setRevealed(false)
  }

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      dialogClassName='max-w-120'
      title={<span className='flex min-h-7 items-center justify-center'>Back Up Wallet</span>}
    >
      {recoveryPhrase ? (
        <div className='flex flex-col gap-4'>
          <div className='border-warning bg-warning/15 text-muted flex items-center gap-3 rounded-xl border-2 p-3 text-sm font-medium'>
            <TriangleExclamationIcon className='text-warning size-6 shrink-0' />
            Anyone who sees the recovery phrase can spend everything in this wallet. Reveal it only
            where nobody is watching.
          </div>
          {revealed ? (
            <RecoveryPhraseWords phrase={recoveryPhrase} />
          ) : (
            <div className='bg-surface-secondary flex flex-col items-center gap-3 rounded-2xl p-6'>
              <span className='text-muted text-sm font-medium'>
                {recoveryPhrase.split(' ').length} words, hidden
              </span>
              <UiButton variant='primary' onPress={() => setRevealed(true)}>
                Reveal phrase
              </UiButton>
            </div>
          )}
          <RecoveryPhraseActions phrase={recoveryPhrase} />
          <p className='text-muted text-xs'>
            The key file holds the derived key, not the phrase: import it in the Wharfedale web app
            (Wallet → Import), or use it with wharfedale-wallet and the SDKs.
          </p>
        </div>
      ) : (
        <p className='text-muted text-sm'>Connect a wallet first.</p>
      )}
    </UiModal>
  )
}
