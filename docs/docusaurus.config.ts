import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'AntTodo',
  tagline: '面向团队的待办应用',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.anttodo.com',
  baseUrl: '/',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'AntTodo',
      logo: {
        alt: 'AntTodo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: '项目介绍',
        },
        {
          href: 'https://app.anttodo.com',
          label: '打开应用',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '文档',
          items: [
            {
              label: '项目介绍',
              to: '/',
            },
            {
              label: '单点登录',
              to: '/企业管理/单点登录',
            },
          ],
        },
        {
          title: '产品',
          items: [
            {
              label: '打开应用',
              href: 'https://app.anttodo.com',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} AntTodo. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
