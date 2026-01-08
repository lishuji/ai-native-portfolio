import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Projects',
      collapsed: false,
      items: [
        'projects/portfolio',
        'projects/backend/order-system',
      ],
    },
    {
      type: 'category',
      label: 'AI Native',
      collapsed: false,
      items: [
        'ai-native/agent-design',
        'ai-native/ai-backend-architecture',
        'ai-native/dify-vs-mcp',
        'ai-native/spec-kit-practice',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/high-concurrency',
        'architecture/distributed-lock',
        'architecture/idempotency',
        'architecture/data-modeling',
        'architecture/system-evolution',
      ],
    },
  ],
};

export default sidebars;
