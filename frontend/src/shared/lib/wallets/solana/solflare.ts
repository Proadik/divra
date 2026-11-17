import { createSolanaStandardAdapter } from './create-standard-adapter'

export const solflare = createSolanaStandardAdapter({
  slug: 'solflare',
  name: 'Solflare',
  standardName: 'Solflare',
  installUrl: 'https://solflare.com/download',
})
