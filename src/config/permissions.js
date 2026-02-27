// ============================================
// Role-Based Permission Configuration
// ============================================
// This file controls which screens each role
// can access in the admin panel.
// 
// To modify admin access, edit the ROLE_PERMISSIONS
// object below. super_admin always has full access.
// ============================================

// Screen keys used for permission checks
export const SCREENS = {
  DASHBOARD: 'dashboard',
  MODULES: 'modules',
  MODULE_REQUESTS: 'module-requests',
  USERS: 'users',
  BANNERS: 'banners',
  FEEDBACKS: 'feedbacks',
  NOTIFICATIONS: 'notifications',
  ASSESSMENTS: 'assessments',
  QUIZ_BUILDER: 'quiz-builder',
  ASSIGNMENT_RESULTS: 'assignment-results',
  VIDEO_PROGRESS: 'video-progress',
  ACTIVE_LOGINS: 'active-logins',
  ANALYTICS: 'analytics',
  SETTINGS: 'settings',
  ADMIN_PERMISSIONS: 'admin-permissions',
}

// Allowed roles that can access the admin panel
export const ALLOWED_ROLES = ['admin', 'super_admin']

// Role-based screen access permissions
// 'all' = access to every screen (super_admin)
// Array  = access only to listed screens (admin)
//
// To give admin access to more screens, simply add
// the screen key to the admin array below.
export const ROLE_PERMISSIONS = {
  super_admin: 'all',
  admin: [
    SCREENS.DASHBOARD,
    SCREENS.MODULES,
    SCREENS.MODULE_REQUESTS,
    SCREENS.BANNERS,
    SCREENS.FEEDBACKS,
    SCREENS.NOTIFICATIONS,
    SCREENS.ASSESSMENTS,
    SCREENS.QUIZ_BUILDER,
    SCREENS.ASSIGNMENT_RESULTS,
    SCREENS.VIDEO_PROGRESS,
  ],
}

// Sidebar navigation items configuration
// Each item maps a route path to a screen permission key
// Order here = order in the sidebar
export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: 'fa-solid fa-chart-pie', screen: SCREENS.DASHBOARD },
  { path: '/modules', label: 'Modules', icon: 'fa-solid fa-puzzle-piece', screen: SCREENS.MODULES },
  { path: '/module-requests', label: 'Module Requests', icon: 'fa-solid fa-user-check', screen: SCREENS.MODULE_REQUESTS },
  { path: '/users', label: 'Users', icon: 'fa-solid fa-users', screen: SCREENS.USERS },
  { path: '/banners', label: 'Banners', icon: 'fa-solid fa-image', screen: SCREENS.BANNERS },
  { path: '/feedbacks', label: 'Feedback', icon: 'fa-solid fa-comment-dots', screen: SCREENS.FEEDBACKS },
  { path: '/notifications', label: 'Notifications', icon: 'fa-regular fa-bell', screen: SCREENS.NOTIFICATIONS },
  { path: '/assessments', label: 'Assessments', icon: 'fa-solid fa-clipboard-question', screen: SCREENS.ASSESSMENTS },
  { path: '/assignment-results', label: 'Assignment Results', icon: 'fa-solid fa-clipboard-list', screen: SCREENS.ASSIGNMENT_RESULTS },
  { path: '/video-progress', label: 'Video Progress', icon: 'fa-solid fa-play-circle', screen: SCREENS.VIDEO_PROGRESS },
  { path: '/active-logins', label: 'Active Logins', icon: 'fa-solid fa-right-to-bracket', screen: SCREENS.ACTIVE_LOGINS },
  { path: '/admin-permissions', label: 'Admin Permissions', icon: 'fa-solid fa-shield-halved', screen: SCREENS.ADMIN_PERMISSIONS },
  { path: '/analytics', label: 'Analytics', icon: 'fa-solid fa-chart-line', screen: SCREENS.ANALYTICS },
]
