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
  VIDEOS: 'videos',
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
  ASSIGN_MODULES: 'assign-modules',
  ASSIGN_PERFORMANCE_DASHBOARD: 'assign-performance-dashboard',
  CATEGORY_ACCESS: 'category-access',
  ANALYTICS: 'analytics',
  SETTINGS: 'settings',
  ADMIN_PERMISSIONS: 'admin-permissions',
  EXCEL_UPLOAD: 'excel-upload',
  PERFORMANCE_MASTER: 'performance-master',
  INFLUENCER_CLAIM: 'influencer-claim',
  INFLUENCER_ENROLLMENT: 'influencer-enrollment',
  INFLUENCER_VISIT: 'influencer-visit',
  LEAD_DETAILS: 'lead-details',
  LEAD_TASK: 'lead-task',
  MASTER_ENROLLMENT: 'master-enrollment',
  TIER_UPGRADE: 'tier-upgrade',
  HOLIDAY: 'holiday',
  ATTENDANCE_REPORT: 'attendance-report',
  TELECALLING_WARTASK: 'telecalling-wartask',
  WORKING_DAYS: 'working-days',
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
    SCREENS.VIDEOS,
    SCREENS.MODULE_REQUESTS,
    SCREENS.BANNERS,
    SCREENS.FEEDBACKS,
    SCREENS.NOTIFICATIONS,
    SCREENS.ASSESSMENTS,
    SCREENS.QUIZ_BUILDER,
    SCREENS.ASSIGNMENT_RESULTS,
    SCREENS.VIDEO_PROGRESS,
    SCREENS.ASSIGN_MODULES,
    SCREENS.ASSIGN_PERFORMANCE_DASHBOARD,
    SCREENS.CATEGORY_ACCESS,
    SCREENS.EXCEL_UPLOAD,
    SCREENS.PERFORMANCE_MASTER,
    SCREENS.INFLUENCER_CLAIM,
    SCREENS.INFLUENCER_ENROLLMENT,
    SCREENS.INFLUENCER_VISIT,
    SCREENS.LEAD_DETAILS,
    SCREENS.LEAD_TASK,
    SCREENS.MASTER_ENROLLMENT,
    SCREENS.TIER_UPGRADE,
    SCREENS.HOLIDAY,
    SCREENS.ATTENDANCE_REPORT,
    SCREENS.TELECALLING_WARTASK,
    SCREENS.WORKING_DAYS,
  ],
}

// Sidebar navigation items configuration
// Each item maps a route path to a screen permission key
// Order here = order in the sidebar
export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: 'fa-solid fa-chart-pie', screen: SCREENS.DASHBOARD },
  { path: '/modules', label: 'Modules', icon: 'fa-solid fa-puzzle-piece', screen: SCREENS.MODULES },
  { path: '/videos', label: 'Videos', icon: 'fa-solid fa-video', screen: SCREENS.VIDEOS },
  { path: '/module-requests', label: 'Module Requests', icon: 'fa-solid fa-user-check', screen: SCREENS.MODULE_REQUESTS },
  { path: '/users', label: 'Users', icon: 'fa-solid fa-users', screen: SCREENS.USERS },
  { path: '/banners', label: 'Banners', icon: 'fa-solid fa-image', screen: SCREENS.BANNERS },
  { path: '/feedbacks', label: 'Feedback', icon: 'fa-solid fa-comment-dots', screen: SCREENS.FEEDBACKS },
  { path: '/notifications', label: 'Notifications', icon: 'fa-regular fa-bell', screen: SCREENS.NOTIFICATIONS },
  { path: '/assessments', label: 'Assessments', icon: 'fa-solid fa-clipboard-question', screen: SCREENS.ASSESSMENTS },
  { path: '/assignment-results', label: 'Assignment Results', icon: 'fa-solid fa-clipboard-list', screen: SCREENS.ASSIGNMENT_RESULTS },
  { path: '/video-progress', label: 'Video Progress', icon: 'fa-solid fa-play-circle', screen: SCREENS.VIDEO_PROGRESS },
  { path: '/active-logins', label: 'Active Logins', icon: 'fa-solid fa-right-to-bracket', screen: SCREENS.ACTIVE_LOGINS },
  { path: '/assign-modules', label: 'Assign Modules', icon: 'fa-solid fa-tasks', screen: SCREENS.ASSIGN_MODULES },
  { path: '/assign-performance-dashboard', label: 'Assign Performance', icon: 'fa-solid fa-chart-bar', screen: SCREENS.ASSIGN_PERFORMANCE_DASHBOARD },
  { path: '/category-access', label: 'Category Access', icon: 'fa-solid fa-layer-group', screen: SCREENS.CATEGORY_ACCESS },
  { path: '/admin-permissions', label: 'Admin Permissions', icon: 'fa-solid fa-shield-halved', screen: SCREENS.ADMIN_PERMISSIONS },
  { path: '/analytics', label: 'Analytics', icon: 'fa-solid fa-chart-line', screen: SCREENS.ANALYTICS },
  { path: '/excel-upload', label: 'Sales Data Upload', icon: 'fa-solid fa-file-excel', screen: SCREENS.EXCEL_UPLOAD },
  { path: '/performance-master', label: 'Performance Master', icon: 'fa-solid fa-database', screen: SCREENS.PERFORMANCE_MASTER },
  { path: '/influencer-claim', label: 'Influencer Claims', icon: 'fa-solid fa-file-invoice', screen: SCREENS.INFLUENCER_CLAIM },
  { path: '/influencer-enrollment', label: 'Influencer Enrollment', icon: 'fa-solid fa-user-plus', screen: SCREENS.INFLUENCER_ENROLLMENT },
  { path: '/influencer-visit', label: 'Influencer Visits', icon: 'fa-solid fa-map-location-dot', screen: SCREENS.INFLUENCER_VISIT },
  { path: '/lead-details', label: 'Lead Details', icon: 'fa-solid fa-bullseye', screen: SCREENS.LEAD_DETAILS },
  { path: '/lead-task', label: 'Lead Tasks', icon: 'fa-solid fa-list-check', screen: SCREENS.LEAD_TASK },
  { path: '/master-enrollment', label: 'Master Enrollment', icon: 'fa-solid fa-address-card', screen: SCREENS.MASTER_ENROLLMENT },
  { path: '/tier-upgrade', label: 'Tier Upgrade Report', icon: 'fa-solid fa-arrow-up-right-dots', screen: SCREENS.TIER_UPGRADE },
  { path: '/holiday', label: 'Holiday Calendar', icon: 'fa-solid fa-calendar-days', screen: SCREENS.HOLIDAY },
  { path: '/attendance-report', label: 'Attendance Report', icon: 'fa-solid fa-clipboard-user', screen: SCREENS.ATTENDANCE_REPORT },
  { path: '/telecalling-wartask', label: 'TeleCalling War Task', icon: 'fa-solid fa-phone-volume', screen: SCREENS.TELECALLING_WARTASK },
  { path: '/working-days', label: 'Working Days', icon: 'fa-solid fa-calendar-week', screen: SCREENS.WORKING_DAYS },
]
