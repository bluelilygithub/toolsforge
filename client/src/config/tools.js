export const TOOLS = [
  {
    id: 'chat',
    name: 'AI Chat',
    icon: '💬',
    lucideIcon: 'message-square',
    path: '/tools/chat',
    description: 'Chat with AI models using your organisation context.',
    requiredPermission: null,
  },
  {
    id: 'advisor',
    name: 'Model Advisor',
    icon: '🧠',
    lucideIcon: 'cpu',
    path: '/tools/advisor',
    description: 'Get recommendations on which AI model fits your task.',
    requiredPermission: null,
  },
  {
    id: 'projects',
    name: 'Projects',
    icon: '📋',
    lucideIcon: 'folder',
    path: '/tools/projects',
    description: 'Manage projects, tasks, milestones and shared files.',
    requiredPermission: null,
  },
  {
    id: 'ads',
    name: 'Google Ads',
    icon: '📊',
    lucideIcon: 'bar-chart-2',
    path: '/tools/ads',
    description: 'Generate reports from your organisation Google Ads data.',
    requiredPermission: 'ads_access',
  },
  {
    id: 'video',
    name: 'Video Studio',
    icon: '🎬',
    lucideIcon: 'video',
    path: '/tools/video',
    description: 'Create video content on demand via API.',
    requiredPermission: 'video_access',
  },
];

// TODO: replace role-based shortcut with PermissionService API call
// when per-user tool permissions are wired to the backend
export function getPermittedTools(userRole) {
  if (userRole === 'org_admin') return TOOLS;
  return TOOLS.filter(t => t.requiredPermission === null);
}
