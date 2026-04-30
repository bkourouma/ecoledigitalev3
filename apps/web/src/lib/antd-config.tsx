import React from 'react';
import { ConfigProvider } from 'antd';
import frFR from 'antd/locale/fr_FR';

// Configuration Ant Design pour l'application
export const antdConfig = {
  locale: frFR,
  theme: {
    token: {
      // Couleurs principales
      colorPrimary: '#1890ff',
      colorSuccess: '#52c41a',
      colorWarning: '#faad14',
      colorError: '#ff4d4f',
      
      // Couleurs de fond
      colorBgContainer: '#ffffff',
      colorBgElevated: '#ffffff',
      
      // Bordures
      borderRadius: 6,
      borderColor: '#d9d9d9',
      
      // Typographie
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: 14,
    },
    components: {
      // Configuration des composants
      Form: {
        labelColor: '#262626',
        labelFontSize: 14,
        itemMarginBottom: 16,
      },
      Input: {
        borderRadius: 6,
        paddingInline: 12,
        paddingBlock: 8,
      },
      Button: {
        borderRadius: 6,
        fontWeight: 500,
      },
      Select: {
        borderRadius: 6,
      },
      Card: {
        borderRadius: 8,
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px 0 rgba(0, 0, 0, 0.02)',
      },
    },
  },
};

// Wrapper pour ConfigProvider
export const AntdConfigProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <ConfigProvider {...antdConfig}>
      {children}
    </ConfigProvider>
  );
};
