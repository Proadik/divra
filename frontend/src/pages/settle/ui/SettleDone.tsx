import type { ReactElement } from 'react'
import type { SettlementResult } from '@/shared/api'
import { env, explorerTxUrl } from '@/shared/config'
import { formatAmount, shortenAddress } from '@/shared/lib/format'
import { Avatar, Button, Icon, toneFor } from '@/shared/ui'

type SettleDoneProps = {
  result: SettlementResult
  groupName: string
  settledAll: boolean
  onBack: () => void
}

const receiptText = (result: SettlementResult, groupName: string): string =>
  [
    `Divra · ${groupName}`,
    ...result.transfers.map((item) => `${item.name}: ${formatAmount(item.amount)} ${result.token}`),
    `Транзакция: ${env.GROUPS_MOCK ? result.signature : explorerTxUrl(result.signature)}`,
  ].join('\n')

export const SettleDone = ({
  result,
  groupName,
  settledAll,
  onBack,
}: SettleDoneProps): ReactElement => {
  const share = async (): Promise<void> => {
    const text = receiptText(result, groupName)
    if (typeof navigator.share === 'function') {
      await navigator.share({ text }).catch(() => undefined)
      return
    }
    await navigator.clipboard.writeText(text).catch(() => undefined)
  }

  return (
    <>
      <section className="settle__done">
        <span className="settle__done-icon">
          <Icon name="check" size={34} strokeWidth={2.4} />
        </span>
        <h2 className="settle__done-title">Отправлено</h2>
        <span className="settle__big">
          {formatAmount(result.total)}
          <span className="settle__summary-cur">{result.token}</span>
        </span>
        <span className="settle__done-sub">
          {groupName}
          {settledAll ? ' · ты в расчёте' : ''}
        </span>
      </section>

      <div className="sp-listgroup">
        {result.transfers.map((item) => (
          <div key={item.memberId} className="sp-row">
            <Avatar initials={item.name.charAt(0)} tone={toneFor(item.name)} />
            <span className="sp-row__body">
              <span className="sp-row__title">{item.name}</span>
              <span className="sp-row__sub">{shortenAddress(item.address)}</span>
            </span>
            <span className="settle__received">
              <span>
                {formatAmount(item.amount)} {result.token}
              </span>
              <span className="settle__ok">получено</span>
            </span>
          </div>
        ))}
        {env.GROUPS_MOCK ? (
          <div className="sp-row">
            <span className="sp-row__body">
              <span className="sp-row__title">Транзакция</span>
              <span className="sp-row__sub">
                {shortenAddress(result.signature)} · мок: в сеть не отправлялась
              </span>
            </span>
          </div>
        ) : (
          <a
            className="sp-row sp-row--action settle__tx"
            href={explorerTxUrl(result.signature)}
            target="_blank"
            rel="noreferrer"
          >
            <span className="sp-row__body">
              <span className="sp-row__title">Транзакция</span>
              <span className="sp-row__sub">{shortenAddress(result.signature)} · подтверждена</span>
            </span>
            <span className="settle__tx-link">
              Solscan <Icon name="arrow-up-right" size={14} />
            </span>
          </a>
        )}
      </div>

      <div className="settle__footer">
        <Button size="lg" block onClick={onBack}>
          Вернуться в группу
        </Button>
        <Button variant="secondary" block onClick={() => void share()}>
          Отправить чек в чат
        </Button>
      </div>
    </>
  )
}
