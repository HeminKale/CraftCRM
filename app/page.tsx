import React from 'react'
import HomePage from './commonfiles/features/auth/page'

export default function Home() {
  try {
    return <HomePage />
  } catch (error) {
    console.error('❌ Root page: Error rendering HomePage:', error)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Error Loading Auth Page
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            There was an error loading the authentication page.
          </p>
          <pre className="text-sm text-red-600 bg-red-50 p-4 rounded">
            {error instanceof Error ? error.message : 'Unknown error'}
          </pre>
        </div>
      </div>
    )
  }
} 