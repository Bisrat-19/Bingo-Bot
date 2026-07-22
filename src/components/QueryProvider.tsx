'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Client-side query cache for the read-heavy tab screens (Wallet, History, Profile).
 *
 * Data is cached in memory for the session so switching tabs is instant, with no
 * spinner. It stays cached until something changes it — the game page invalidates the
 * relevant queries when the balance moves or a round ends, and the Reload buttons
 * refetch on demand. No external cache (Redis etc.) is involved: React Query holds it
 * all on the client.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Cached until we explicitly invalidate it.
            staleTime: Infinity,
            gcTime: 30 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
