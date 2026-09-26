-- Department Mandatory Modules Mapping
-- Stores which modules are mandatory for each department.
-- This migration is additive and non-destructive.

CREATE TABLE IF NOT EXISTS public.department_mandatory_modules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id integer NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT department_mandatory_modules_unique UNIQUE (department_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_department_mandatory_modules_department_id
  ON public.department_mandatory_modules (department_id);

CREATE INDEX IF NOT EXISTS idx_department_mandatory_modules_module_id
  ON public.department_mandatory_modules (module_id);

ALTER TABLE public.department_mandatory_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow admin and super_admin full access to department_mandatory_modules" ON public.department_mandatory_modules;
CREATE POLICY "Allow admin and super_admin full access to department_mandatory_modules"
ON public.department_mandatory_modules
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'super_admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'super_admin')
  )
);

CREATE OR REPLACE FUNCTION public.update_department_mandatory_modules_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_department_mandatory_modules_updated_at ON public.department_mandatory_modules;
CREATE TRIGGER trg_update_department_mandatory_modules_updated_at
BEFORE UPDATE ON public.department_mandatory_modules
FOR EACH ROW
EXECUTE FUNCTION public.update_department_mandatory_modules_updated_at();
