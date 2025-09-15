import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './commonfiles/core/globals.css'
import CoreLayout from './commonfiles/core/layout'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || 'Craft App',
  description: process.env.NEXT_PUBLIC_APP_DESCRIPTION || 'Multi-tenant SaaS platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <CoreLayout>
          {children}
        </CoreLayout>
      </body>
    </html>
  )
} 