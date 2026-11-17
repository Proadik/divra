import { useQueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { groupKeys, inviteKeys, resetMockData } from '@/shared/api'
import { FEATURE_FLAGS, FLAG_NAMES, type FlagName } from '@/shared/config'
import {
  flagsSource,
  useFeatureFlagsStore,
  useFlag,
  writeLocalFlag,
} from '@/shared/lib/feature-flags'
import { Checkbox } from '@/shared/ui'

const FlagRow = ({ name, editable }: { name: FlagName; editable: boolean }): ReactElement => {
  const on = useFlag(name)
  const fromSource = useFeatureFlagsStore((state) => state.values[name] !== undefined)
  return (
    <div className="sp-row settings__flag">
      <label className="settings__flag-label">
        <Checkbox
          checked={on}
          disabled={!editable}
          onChange={(event) => writeLocalFlag(name, event.currentTarget.checked)}
        />
        <span className="sp-row__body">
          <span className="sp-row__title settings__flag-name">{name}</span>
          <span className="sp-row__sub">{FEATURE_FLAGS[name].description}</span>
        </span>
      </label>
      {editable && fromSource ? (
        <button
          type="button"
          className="settings__flag-reset"
          onClick={() => writeLocalFlag(name, null)}
        >
          сбросить
        </button>
      ) : (
        <span className="settings__flag-source">{fromSource ? 'из базы' : 'дефолт'}</span>
      )}
    </div>
  )
}

/**
 * Фича-флаги. С локальным источником переключатели пишут в «базу» в localStorage —
 * изменение сразу подхватывают все открытые вкладки. С удалённым — только просмотр:
 * значения меняются в базе бэкенда.
 */
export const FeatureFlagsPanel = (): ReactElement => {
  const editable = flagsSource.kind === 'local'
  const queryClient = useQueryClient()
  const resetData = async (): Promise<void> => {
    await resetMockData()
    await queryClient.resetQueries({ queryKey: groupKeys.all })
    await queryClient.resetQueries({ queryKey: inviteKeys.all })
  }
  return (
    <section className="settings__section" aria-labelledby="settings-flags">
      <h2 id="settings-flags" className="settings__heading">
        Фича-флаги
      </h2>
      <div className="sp-listgroup">
        {FLAG_NAMES.map((name) => (
          <FlagRow key={name} name={name} editable={editable} />
        ))}
      </div>
      <button type="button" className="settings__flag-reset" onClick={() => void resetData()}>
        Сбросить мок-данные
      </button>
      <p className="settings__hint">
        {editable
          ? 'Локальная «база» флагов: изменение сразу применяется во всех вкладках, данные перезагружаются из нового источника.'
          : 'Флаги приходят с бэкенда (GET /flags) и применяются на лету. Поменять — в базе.'}
      </p>
    </section>
  )
}
