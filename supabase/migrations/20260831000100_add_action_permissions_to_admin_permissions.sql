-- Add action-level permissions for each screen/module in admin_permissions.
-- Structure example:
-- {
--   "assign-modules": { "view": true, "edit": true, "delete": false }
-- }

ALTER TABLE public.admin_permissions
ADD COLUMN IF NOT EXISTS action_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;
