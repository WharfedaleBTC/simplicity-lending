/**
 * Copies text. The Clipboard API exists only on secure origins (HTTPS or localhost); over plain
 * HTTP this falls back to `execCommand('copy')`, which browsers still allow from a click.
 * Returns whether the text was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the fallback
  }
  return copyWithExecCommand(text)
}

function copyWithExecCommand(text: string): boolean {
  // The copy event carries the text itself, so the copy doesn't depend on a selection: dialogs
  // and popovers keep focus inside them, and a selection outside never takes.
  let delivered = false
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
    delivered = true
  }
  // A selected copy of the text as well, for browsers without clipboardData on the event; kept
  // inside the focused dialog so its focus trap allows the selection.
  const host =
    document.activeElement?.closest<HTMLElement>('[role="dialog"], [role="menu"]') ?? document.body
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  host.appendChild(area)
  const previousFocus = document.activeElement as HTMLElement | null
  area.focus({ preventScroll: true })
  area.select()
  area.setSelectionRange(0, text.length)
  document.addEventListener('copy', onCopy, true)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.removeEventListener('copy', onCopy, true)
    area.remove()
    previousFocus?.focus({ preventScroll: true })
  }
  return ok && (delivered || area.selectionEnd - area.selectionStart === text.length)
}
