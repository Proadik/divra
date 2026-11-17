import { createSolanaStandardAdapter } from './create-standard-adapter'

export const phantom = createSolanaStandardAdapter({
  slug: 'phantom',
  name: 'Phantom',
  standardName: 'Phantom',
  installUrl: 'https://phantom.com/download',
})
