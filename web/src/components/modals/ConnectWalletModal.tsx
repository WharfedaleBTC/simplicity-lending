import { useEffect, useState } from 'react'

import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { MnemonicInput } from '@/components/MnemonicInput'
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
  const [connecting, setConnecting] = useState(false)
  const [wasOpen, setWasOpen] = useState(isOpen)

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setMnemonic('')
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

  const canConnect =
    mnemonic.split(/\s+/).filter(Boolean).length === 12 && isValidMnemonic(mnemonic)
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
          Your recovery phrase stays in this browser tab. Use the phrase of your Wharfedale web
          wallet, or generate a new one and write it down.
        </div>
        <MnemonicInput onChange={setMnemonic} />
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
