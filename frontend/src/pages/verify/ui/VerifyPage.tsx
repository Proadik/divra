import type { ReactElement } from 'react'
import { useWalletSession } from '@/entities/wallet'
import { DisconnectButton, VerifyWalletCard } from '@/features/wallet-auth'
import { Logo } from '@/shared/ui'
import './VerifyPage.css'

export const VerifyPage = (): ReactElement => {
  const notice = useWalletSession((state) => state.notice)

  return (
    <main className="verify page-enter">
      <header className="verify__header">
        <Logo height={28} />
      </header>

      <section className="verify__hero" aria-labelledby="verify-page-title">
        <span className="verify__step">Шаг 2 из 2</span>
        <h1 id="verify-page-title" className="verify__title">
          Подтверди кошелёк
        </h1>
        <p className="verify__lead">
          Подпиши транзакцию от Divra — так мы убедимся, что кошелёк принадлежит тебе.
        </p>
      </section>

      {notice === 'account-changed' && (
        <p className="verify__notice" role="status">
          В кошельке выбран другой аккаунт. Подтверди новый адрес.
        </p>
      )}
      {notice === 'session-expired' && (
        <p className="verify__notice" role="status">
          Сессия истекла. Подпиши вход ещё раз — это бесплатно.
        </p>
      )}

      <VerifyWalletCard />

      <div className="verify__footer">
        <DisconnectButton variant="text" label="Выбрать другой кошелёк" />
      </div>
    </main>
  )
}
