import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: '项目介绍',
    },
    {
      type: 'category',
      label: '企业管理',
      items: [
        {
          type: 'doc',
          id: '企业管理/单点登录',
          label: '单点登录',
        },
        {
          type: 'doc',
          id: '企业管理/通知配置',
          label: '通知配置',
        },
      ],
    },
  ],
};

export default sidebars;
