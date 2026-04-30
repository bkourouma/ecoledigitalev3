"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { SessionProvider } from "next-auth/react";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as HotToaster } from "react-hot-toast";
import { Toaster as SonnerToaster } from "sonner";
import { initChunkErrorHandler } from "@/lib/chunk-error-handler";
import { AntdConfigProvider } from "@/lib/antd-config";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TenantProvider } from "@/contexts/TenantContext";
import { saveToken, removeToken } from "@/lib/jwt-storage";

// Initialiser le gestionnaire d'erreurs de chunk immédiatement (avant React)
// Cela garantit qu'il est actif dès le chargement du module
if (typeof window !== 'undefined') {
  initChunkErrorHandler();
}

function SessionAuthSync() {
  const { data: session, status } = useSession();
  const jwtToken = (session as any)?.jwtToken as string | undefined;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (status === "authenticated" && jwtToken) {
      saveToken(jwtToken);
      localStorage.removeItem("superAdminToken");
      localStorage.removeItem("superAdminEmail");
      localStorage.removeItem("superAdminSelectedTenant");
      return;
    }

    if (status === "unauthenticated") {
      removeToken();
    }
  }, [jwtToken, status]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <TenantProvider>
      <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
        <SessionAuthSync />
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AntdConfigProvider>
              <AppLayout>
                {children}
              </AppLayout>
              <Toaster />
              <HotToaster
                position="top-right"
                toastOptions={{
                  duration: 4000,
                  style: {
                    background: '#363636',
                    color: '#fff',
                  },
                  success: {
                    duration: 3000,
                    iconTheme: {
                      primary: '#4ade80',
                      secondary: '#fff',
                    },
                  },
                  error: {
                    duration: 5000,
                    iconTheme: {
                      primary: '#ef4444',
                      secondary: '#fff',
                    },
                  },
                }}
              />
              <SonnerToaster position="top-right" />
            </AntdConfigProvider>
            <ReactQueryDevtools initialIsOpen={false} />
          </ThemeProvider>
        </QueryClientProvider>
      </SessionProvider>
    </TenantProvider>
  );
}
