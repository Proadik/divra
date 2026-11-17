import type { ReactElement, ReactNode } from 'react'
import { Navigate } from 'react-router'
import { type WalletSessionStatus, useWalletSession } from '@/entities/wallet'
import { ROUTES, joinPath } from '@/shared/config'
import { getPendingInvite } from '@/shared/lib/pending-invite'
import './SessionGate.css'

/**
 * guest — кошелёк не подключён (экран выбора кошелька)
 * unverified — подключён, но не подтверждён подписью
 * verified — полный доступ
 * any — страница открыта всем (приглашение по ссылке), ждём только восстановления сессии
 */
export type SessionAccess = 'guest' | 'unverified' | 'verified' | 'any'

const ALLOWED: Record<SessionAccess, readonly WalletSessionStatus[]> = {
  guest: ['disconnected', 'connecting'],
  unverified: ['connected'],
  verified: ['verified'],
  any: ['disconnected', 'connecting', 'connected', 'verified'],
}

const homeFor = (status: WalletSessionStatus): string => {
  if (status === 'verified') {
    // Пришёл по приглашению до входа — после подтверждения возвращаем к нему
    const invite = getPendingInvite()
    return invite ? joinPath(invite) : ROUTES.home
  }
  return status === 'connected' ? ROUTES.verify : ROUTES.connect
}

/** Пускает на страницу только в нужном состоянии сессии, иначе перенаправляет. */
export const SessionGate = ({
  access,
  children,
}: {
  access: SessionAccess
  children: ReactNode
}): ReactElement => {
  const status = useWalletSession((state) => state.status)

  if (status === 'restoring') {
    return (
      <div className="session-gate" role="status">
        Восстанавливаем подключение к кошельку…
      </div>
    )
  }

  return ALLOWED[access].includes(status) ? (
    <>{children}</>
  ) : (
    <Navigate to={homeFor(status)} replace />
  )
}
