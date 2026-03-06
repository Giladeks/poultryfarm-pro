// app/layout.js — Root layout
import './globals.css';
import { AuthProvider } from '@/components/layout/AuthProvider';

export const metadata = {
  title: 'PoultryFarm Pro',
  description: 'Cloud-based farm management platform for poultry operations of all sizes.',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, background: '#060a06', minHeight: '100vh' }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
