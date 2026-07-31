import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE } from '@ai-rpg/shared';

// 命名空间翻译文件（locale json 逐字节复制自 packages/frontend/src/i18n/locales/）
import common_zhCN from './locales/zh-CN/common.json';
import game_zhCN from './locales/zh-CN/game.json';
import common_enUS from './locales/en-US/common.json';
import game_enUS from './locales/en-US/game.json';

// 渲染主链路仅消费 common/game 两个命名空间，沙箱按同一结构挂载子集
export const NAMESPACES = ['common', 'game'] as const;
export type Namespace = (typeof NAMESPACES)[number];

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': {
      common: common_zhCN,
      game: game_zhCN,
    },
    'en-US': {
      common: common_enUS,
      game: game_enUS,
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
