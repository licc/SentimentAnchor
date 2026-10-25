let tail: Promise<unknown> = Promise.resolve()

/**
 * One trading action at a time across auto ticks, manual orders and flatten.
 * Broker HTTP calls have their own queue; this lock serializes business actions.
 */
export function withTradeLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail
  let release!: () => void
  const turn = new Promise<void>((resolve) => { release = resolve })
  tail = previous.then(() => turn).catch(() => turn)
  return previous.then(async () => {
    try {
      return await fn()
    } finally {
      release()
    }
  })
}
