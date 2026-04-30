"use client";

import { useEffect } from 'react';
import { useUIStore } from '@/lib/stores/ui-store';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useUIStore();

  useEffect(() => {
    // Initialize theme on mount to avoid hydration mismatch
    const root = document.documentElement;
    
    // Remove any existing theme classes first
    root.classList.remove('dark', 'light');
    
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.add('light');
    } else {
      // System preference
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (systemDark) {
        root.classList.add('dark');
      } else {
        root.classList.add('light');
      }
    }
  }, [theme]);

  // Set default theme on first load
  useEffect(() => {
    if (!theme) {
      setTheme('dark'); // Default to dark theme
    }
  }, [theme, setTheme]);

  return <>{children}</>;
}
