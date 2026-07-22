import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { QueryProvider } from '@/components/QueryProvider';

export const metadata: Metadata = {
  title: 'Chewata',
  description: 'Multiplayer Bingo Mini App',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Telegram's runtime injects theme CSS variables onto <html>/<body> before React
    // hydrates, so suppress the (benign) attribute hydration mismatch it causes.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Official Telegram Mini App runtime — must load before our app reads it. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <ErrorBoundary>
          <QueryProvider>{children}</QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
