export const RoutePath = {
  Overview: '/',
  Market: '/market',
  Offer: '/offers/:offerId',
  Borrow: '/borrow',
  CreateOffer: '/borrow/new',
  Lend: '/lend',
  Wallet: '/wallet',
  WalletNew: '/wallet/new',
  WalletImport: '/wallet/import',
  WalletBackup: '/wallet/backup',
} as const

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath]

export const offerPath = (offerId: string): string => `/offers/${encodeURIComponent(offerId)}`
