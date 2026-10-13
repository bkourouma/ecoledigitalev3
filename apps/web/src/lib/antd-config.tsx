import React from 'react';
import { ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';
import frFR from 'antd/locale/fr_FR';

/**
 * Thème Ant Design de l'application. Ant Design ne sert qu'aux CONTRÔLES DE FORMULAIRE (champs, listes, cases : voir
 * `platform/ui/FormField.tsx`) ; le reste de l'interface reste en Tailwind. L'application est sombre (variables de `globals.css`) :
 * les jetons ci-dessous en reprennent les valeurs (Ant Design calcule ses teintes dérivées en JS, il lui faut des couleurs, pas des
 * `var(--…)`).
 */
const PRIMARY = '#8b5cf6'; // --primary
const INPUT_BG = '#2c3139'; // --input
const SURFACE = '#24282e'; // --card / --popover
const BORDER = '#3d4450'; // --border (un cran plus clair : un champ doit se voir sur la carte)

export const antdTokens: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: PRIMARY,
    colorError: '#f26b6b', // --destructive
    colorSuccess: '#34d399',
    colorWarning: '#fbbf24',
    colorBgContainer: INPUT_BG,
    colorBgElevated: SURFACE,
    colorBorder: BORDER,
    colorText: '#f8fafc', // --foreground
    colorTextPlaceholder: '#7c8aa0',
    colorTextDisabled: '#64748b',
    borderRadius: 10,
    controlHeight: 36,
    controlHeightLG: 44, // cible tactile : 44 px, comme les boutons du reste de l'application
    fontFamily: 'inherit',
    fontSize: 14,
  },
  components: {
    Input: { activeShadow: '0 0 0 3px rgba(139, 92, 246, 0.25)', paddingInlineLG: 14 },
    Select: {
      optionSelectedBg: 'rgba(139, 92, 246, 0.2)',
      optionActiveBg: 'rgba(255, 255, 255, 0.06)',
      optionPadding: '8px 12px',
      optionLineHeight: 1.45,
    },
    Checkbox: { borderRadiusSM: 5 },
  },
};

export const antdConfig = {
  locale: frFR,
  theme: antdTokens,
};

export const AntdConfigProvider = ({ children }: { children: React.ReactNode }) => {
  return React.createElement(ConfigProvider, antdConfig, children);
};
