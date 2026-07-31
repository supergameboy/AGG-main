import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE } from '@ai-rpg/shared';

// 命名空间翻译文件
import common_zhCN from './locales/zh-CN/common.json';
import game_zhCN from './locales/zh-CN/game.json';
import settings_zhCN from './locales/zh-CN/settings.json';
import template_zhCN from './locales/zh-CN/template.json';
import character_zhCN from './locales/zh-CN/character.json';
import devtools_zhCN from './locales/zh-CN/devtools.json';
import navigation_zhCN from './locales/zh-CN/navigation.json';

import common_enUS from './locales/en-US/common.json';
import game_enUS from './locales/en-US/game.json';
import settings_enUS from './locales/en-US/settings.json';
import template_enUS from './locales/en-US/template.json';
import character_enUS from './locales/en-US/character.json';
import devtools_enUS from './locales/en-US/devtools.json';
import navigation_enUS from './locales/en-US/navigation.json';

export const NAMESPACES = ['common', 'game', 'settings', 'template', 'character', 'devtools', 'navigation'] as const;
export type Namespace = (typeof NAMESPACES)[number];

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': {
      common: common_zhCN,
      game: game_zhCN,
      settings: settings_zhCN,
      template: template_zhCN,
      character: character_zhCN,
      devtools: devtools_zhCN,
      navigation: navigation_zhCN,
    },
    'en-US': {
      common: common_enUS,
      game: game_enUS,
      settings: settings_enUS,
      template: template_enUS,
      character: character_enUS,
      devtools: devtools_enUS,
      navigation: navigation_enUS,
    },
  },
  lng: DEFAULT_LOCALE,
  fallbackLng: 'zh-CN',
  ns: NAMESPACES,
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
