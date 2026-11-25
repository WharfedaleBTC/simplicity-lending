export const RoutePath = {
  Landing: '/',
  Dashboard: '/app',
  Borrow: '/app/borrow',
  Supply: '/app/supply',
  DesignSystem: '/app/design-system',
} as const

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath]
