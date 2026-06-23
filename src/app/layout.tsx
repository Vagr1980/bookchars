import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BookChars — Визуализатор персонажей книг',
  description: 'Загрузи книгу — AI нарисует портреты героев и покажет граф их связей',
  openGraph: {
    title: 'BookChars',
    description: 'AI-визуализация персонажей книг',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
