import { useFeatureFlagsStore } from '../feature-flags'

/** Включить демо-данные мока (флаги mock.*), как будто их включили в базе флагов. */
export const enableDemoData = (): void => {
  useFeatureFlagsStore.setState({
    values: { 'mock.groups': true, 'mock.rates': true },
    loaded: true,
  })
}
