import { useEffect } from 'react'
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
} from 'react-router-dom'

import ErrorBoundary from '@/components/ErrorBoundary'
import { RoutePath } from '@/constants/routes'
import BorrowPage from '@/pages/Borrow'
import CreateOfferPage from '@/pages/CreateOffer'
import LendPage from '@/pages/Lend'
import MarketPage from '@/pages/Market'
import OfferPage from '@/pages/Offer'
import OverviewPage from '@/pages/Overview'
import { WalletBackupPage, WalletImportPage, WalletNewPage, WalletPage } from '@/pages/Wallet'
import { AppProviders } from '@/providers/AppProviders'
import { initAnalytics, trackPageView } from '@/utils/analytics'

function Root() {
  const { pathname } = useLocation()
  useEffect(() => {
    initAnalytics()
  }, [])
  useEffect(() => {
    trackPageView(pathname)
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  )
}

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <ErrorBoundary />,
    children: [
      { path: RoutePath.Overview, element: <OverviewPage /> },
      { path: RoutePath.Market, element: <MarketPage /> },
      { path: RoutePath.Offer, element: <OfferPage /> },
      { path: RoutePath.Borrow, element: <BorrowPage /> },
      { path: RoutePath.CreateOffer, element: <CreateOfferPage /> },
      { path: RoutePath.Lend, element: <LendPage /> },
      { path: RoutePath.Wallet, element: <WalletPage /> },
      { path: RoutePath.WalletNew, element: <WalletNewPage /> },
      { path: RoutePath.WalletImport, element: <WalletImportPage /> },
      { path: RoutePath.WalletBackup, element: <WalletBackupPage /> },
      // The previous app's addresses.
      { path: '/app', element: <Navigate to={RoutePath.Overview} replace /> },
      { path: '/app/borrow', element: <Navigate to={RoutePath.Borrow} replace /> },
      { path: '/app/supply', element: <Navigate to={RoutePath.Lend} replace /> },
      { path: '*', element: <Navigate to={RoutePath.Overview} replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
