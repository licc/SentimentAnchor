import { createContext, useContext, type ReactNode } from 'react'
import { useEtfDesk } from '../hooks/useEtfDesk'

type Desk = ReturnType<typeof useEtfDesk>
const Ctx = createContext<Desk | null>(null)

export function EtfDeskProvider({ children }: { children: ReactNode }) {
  const desk = useEtfDesk()
  return <Ctx.Provider value={desk}>{children}</Ctx.Provider>
}

export function useEtfDeskContext(): Desk {
  const value = useContext(Ctx)
  if (!value) throw new Error('EtfDeskProvider is missing')
  return value
}
