import type { ReactNode } from 'react'
import type { AuthUser } from '../../types'
import { AccountMenu } from '../AccountMenu'
import { MobileNav } from '../MobileNav'
import { TopBar, type NavKey } from '../TopBar'

export type { NavKey }

type Props = {
  user: AuthUser
  onLogout: () => void
  children: ReactNode
  showSearch?: boolean
  search?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
  navActive?: NavKey
  actionsExtra?: ReactNode
  onScan?: () => void
  scanning?: boolean
  className?: string
}

export function CinemaShell({
  user,
  onLogout,
  children,
  showSearch,
  search,
  onSearchChange,
  searchPlaceholder,
  navActive,
  actionsExtra,
  onScan,
  scanning,
  className,
}: Props) {
  const shellClass = ['app-shell', 'has-mobile-nav', className].filter(Boolean).join(' ')
  return (
    <div className={shellClass}>
      <TopBar
        showSearch={showSearch}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        navActive={navActive}
        actions={
          <>
            {actionsExtra}
            <AccountMenu
              user={user}
              onLogout={onLogout}
              onScan={onScan}
              scanning={scanning}
            />
          </>
        }
      />
      {children}
      <MobileNav />
    </div>
  )
}
