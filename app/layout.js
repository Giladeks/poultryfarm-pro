// app/layout.js — Root layout
import './globals.css';
import { AuthProvider } from '@/components/layout/AuthProvider';

export const metadata = {
  title: 'PoultryFarm Pro',
  description: 'Cloud-based farm management platform for poultry operations of all sizes.',
  manifest: '/manifest.json',
  icons: {
    icon:  '/favicon.ico',
    apple: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'PoultryFarm Pro',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#6c63ff',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* PWA manifest — must be an explicit <link> as well for broad browser support */}
        <link rel="manifest" href="/manifest.json" />

        {/* iOS PWA meta tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="PoultryFarm Pro" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />

        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Nunito:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, background: '#060a06', minHeight: '100vh' }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
