'use client';

import './globals.css'
import { SupabaseProvider } from './providers/SupabaseProvider'
import { PermissionsProvider } from './providers/PermissionsProvider'
import { Toaster } from 'react-hot-toast'

export default function CoreLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SupabaseProvider>
      <PermissionsProvider>
        {children}
        <Toaster position="top-right" />
      </PermissionsProvider>
    </SupabaseProvider>
  )
} 