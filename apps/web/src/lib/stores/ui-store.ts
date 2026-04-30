import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import React from 'react';

interface UIState {
  // Sidebar state
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  
  // Theme state
  theme: 'light' | 'dark' | 'system';
  
  // User context
  userRole: 'admin' | 'student' | 'parent' | null;
  tenantSlug: string | null;
  
  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setUserContext: (role: 'admin' | 'student' | 'parent', tenant: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Initial state
      sidebarCollapsed: false,
      sidebarOpen: true,
      theme: 'system',
      userRole: null,
      tenantSlug: null,

      // Actions
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      
      setTheme: (theme) => {
        set({ theme });
        // Theme application is now handled by ThemeProvider to avoid hydration issues
      },
      
      setUserContext: (role, tenant) => {
        set({ userRole: role, tenantSlug: tenant });
        
        // Apply role and tenant attributes to document
        if (typeof window !== 'undefined') {
          const root = document.documentElement;
          root.setAttribute('data-role', role);
          root.setAttribute('data-tenant', tenant);
        }
      },
    }),
    {
      name: 'ecoledigitale-ui-store',
      partialize: (state) => ({ 
        theme: state.theme, 
        sidebarCollapsed: state.sidebarCollapsed 
      }),
    }
  )
);

// Hook to initialize theme on mount
export const useThemeInitializer = () => {
  const { theme, setTheme } = useUIStore();
  
  React.useEffect(() => {
    // Initialize theme on first load
    setTheme(theme);
    
    // Listen for system theme changes
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => setTheme('system');
      
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme, setTheme]);
};
