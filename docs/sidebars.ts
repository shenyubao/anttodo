import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: '项目介绍',
    },
    {
      type: 'doc',
      id: 'changelog',
      label: 'ChangeLog',
    },
    {
      type: 'doc',
      id: 'deep-links',
      label: 'macOS DeepLink',
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
          id: '企业管理/连接器',
          label: '连接器',
        },
        {
          type: 'doc',
          id: '企业管理/通知配置',
          label: '通知配置',
        },
      ],
    },
    {
      type: 'category',
      label: 'CLI',
      items: [
        {
          type: 'doc',
          id: 'cli/quickstart',
          label: '快速开始',
        },
      ],
    },
  ],
};

export default sidebars;
