'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  Settings, 
  Database, 
  Users, 
  Layout, 
  Shield, 
  Home,
  Plus,
  FolderOpen
} from 'lucide-react'
import { cn } from '../core/lib/utils'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Objects', href: '/dashboard/objects', icon: Database },
  { name: 'Records', href: '/dashboard/records', icon: FolderOpen },
  { name: 'Settings', href: '/settings', icon: Settings },
]

const settingsNavigation = [
  { name: 'Objects', href: '/settings/objects', icon: Database },
  { name: 'Fields', href: '/settings/fields', icon: Plus },
  { name: 'Layouts', href: '/settings/layouts', icon: Layout },
  { name: 'Permissions', href: '/settings/permissions', icon: Shield },
  { name: 'Users', href: '/settings/users', icon: Users },
]

export function Sidebar() {
  const pathname = usePathname()
  const isSettingsPage = pathname.startsWith('/settings')

  const currentNavigation = isSettingsPage ? settingsNavigation : navigation

  return (
    <div className="flex h-full w-64 flex-col bg-gray-50 border-r border-gray-200">
      <div className="flex h-16 items-center px-6 border-b border-gray-200">
        <h1 className="text-xl font-semibold text-gray-900">
          {process.env.NEXT_PUBLIC_APP_NAME || 'Craft App'}
        </h1>
      </div>
      
      <nav className="flex-1 space-y-1 px-3 py-4">
        {currentNavigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/dashboard' && pathname.startsWith(item.href))
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                isActive
                  ? 'bg-blue-100 text-blue-700 border-r-2 border-blue-700'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <item.icon
                className={cn(
                  'mr-3 h-5 w-5 flex-shrink-0',
                  isActive ? 'text-blue-700' : 'text-gray-400 group-hover:text-gray-500'
                )}
              />
              {item.name}
            </Link>
          )
        })}
      </nav>
      
      <div className="border-t border-gray-200 p-4">
        <div className="text-xs text-gray-500">
          Multi-tenant platform
        </div>
      </div>
    </div>
  )
} 