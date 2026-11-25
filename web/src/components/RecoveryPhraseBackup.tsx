import CheckIcon from '@/components/icons/CheckIcon'
import CopyIcon from '@/components/icons/CopyIcon'
import { UiButton } from '@/components/ui/UiButton'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { downloadKeyFile } from '@/utils/keyFile'

/** The words of a recovery phrase, numbered, read-only. */
export function RecoveryPhraseWords({ phrase }: { phrase: string }) {
  return (
    <ol
      aria-label='Recovery phrase'
      className='bg-surface-secondary grid grid-cols-2 gap-2 rounded-2xl p-3 sm:grid-cols-3'
    >
      {phrase.split(' ').map((word, index) => (
        <li
          key={index}
          className='bg-surface flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium'
        >
          <span className='bg-surface-secondary text-muted flex size-4.5 shrink-0 items-center justify-center rounded-full text-[10px] tabular-nums'>
            {index + 1}
          </span>
          <span className='truncate font-mono'>{word}</span>
        </li>
      ))}
    </ol>
  )
}

/** Copy the words, or download the key file the Wharfedale web app, CLI and SDKs import. */
export function RecoveryPhraseActions({ phrase }: { phrase: string }) {
  const [copied, copy] = useCopyToClipboard()

  return (
    <div className='grid grid-cols-2 gap-2'>
      <UiButton variant='secondary' fullWidth onPress={() => copy(phrase)}>
        {copied ? <CheckIcon className='size-4' /> : <CopyIcon className='size-4' />}
        {copied ? 'Copied' : 'Copy words'}
      </UiButton>
      <UiButton variant='secondary' fullWidth onPress={() => downloadKeyFile(phrase)}>
        Download key file
      </UiButton>
    </div>
  )
}
