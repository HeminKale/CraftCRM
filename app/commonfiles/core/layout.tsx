'use client';

import './globals.css'
import { SupabaseProvider } from './providers/SupabaseProvider'
import { Toaster } from 'react-hot-toast'

export default function CoreLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SupabaseProvider>
      {children}
      <Toaster position="top-right" />
    </SupabaseProvider>
  )
} 