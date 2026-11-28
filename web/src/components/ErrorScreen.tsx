interface ErrorScreenProps {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

/** Start-up and route failures: no config, node unreachable, an unknown page. */
export function ErrorScreen({
  title,
  description,
  actionLabel = 'Back to the overview',
  onAction = () => {
    window.location.href = '/'
  },
}: ErrorScreenProps) {
  return (
    <main className='startup-error' role='alert'>
      <span className='label label--mark'>Lending on Wharfedale</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <button type='button' className='button primary' onClick={onAction}>
        {actionLabel}
      </button>
    </main>
  )
}
