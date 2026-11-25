import { useEffect, useState } from 'react'

import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { MnemonicInput } from '@/components/MnemonicInput'
import { RecoveryPhraseActions } from '@/components/RecoveryPhraseBackup'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useWallet } from '@/providers/wallet/useWallet'
import { isValidMnemonic } from '@/wharfedale/wallet'

interface ConnectWalletModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The recovery-phrase wallet of the Wharfedale web app (same keys and addresses). The phrase
 * stays in this tab: the key is derived, coins are unblinded and transactions are signed in
 * the page.
 */
export function ConnectWalletModal({ isOpen, onOpenChange }: ConnectWalletModalProps) {
  const { connect, connectionStatus, isError, error } = useWallet()
  const [mnemonic, setMnemonic] = useState('')
  // A phrase generated here must be backed up before connecting: the tab forgets it on close.
  const [generated, setGenerated] = useState<string | null>(null)
  const [backedUp, setBackedUp] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [wasOpen, setWasOpen] = useState(isOpen)

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setMnemonic('')
      setGenerated(null)
      setBackedUp(false)
    }
  }

  useEffect(() => {
    if (isOpen && connectionStatus === 'ready') onOpenChange(false)
  }, [isOpen, connectionStatus, onOpenChange])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      await connect(mnemonic)
    } finally {
      setConnecting(false)
    }
  }

  const isGenerated = generated !== null && generated === mnemonic
  const canConnect =
    mnemonic.split(/\s+/).filter(Boolean).length === 12 &&
    isValidMnemonic(mnemonic) &&
    (!isGenerated || backedUp)
  const visibleError = isError ? error : null

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      dialogClassName='max-w-120'
      title={<span className='flex min-h-7 items-center justify-center'>Connect Wallet</span>}
    >
      <div className='flex flex-col gap-4'>
        <div className='border-warning bg-warning/15 text-muted flex items-center gap-3 rounded-xl border-2 p-3 text-sm font-medium'>
          <TriangleExclamationIcon className='text-warning size-6 shrink-0' />
          Your recovery phrase stays in this browser tab and is forgotten when it closes. Use the
          phrase of your Wharfedale web wallet, or generate a new one and back it up.
        </div>
        <MnemonicInput
          onChange={setMnemonic}
          onGenerate={phrase => {
            setGenerated(phrase)
            setBackedUp(false)
          }}
        />
        {isGenerated && (
          <div className='border-border flex flex-col gap-3 rounded-2xl border p-3'>
            <p className='text-sm font-medium'>
              Back up these 12 words, in order, and keep them offline. They are the only way to
              restore this wallet; the key file restores it in the Wharfedale web app.
            </p>
            <RecoveryPhraseActions phrase={mnemonic} />
            <label className='flex cursor-pointer items-center gap-2 text-sm font-medium'>
              <input
                type='checkbox'
                className='accent-accent size-4'
                checked={backedUp}
                onChange={event => setBackedUp(event.target.checked)}
              />
              I wrote the words down in order
            </label>
          </div>
        )}
        {visibleError && <p className='text-danger text-sm'>{visibleError}</p>}
        <UiButton
          variant='primary'
          fullWidth
          isPending={connecting}
          loadingText='Connecting…'
          isDisabled={!canConnect}
          onPress={() => void handleConnect()}
        >
          Connect
        </UiButton>
      </div>
    </UiModal>
  )
}
