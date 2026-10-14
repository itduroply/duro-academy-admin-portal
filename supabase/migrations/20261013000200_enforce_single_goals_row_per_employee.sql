-- Enforce one goals_master row per employee.
-- 1) Keep latest row per employee and delete older duplicates.
-- 2) Add UNIQUE(employee_code) so duplicates cannot be inserted again.

-- Delete all but latest row for each employee_code.
WITH ranked AS (
  SELECT
    id,
    employee_code,
    ROW_NUMBER() OVER (
      PARTITION BY employee_code
      ORDER BY COALESCE(updated_at, NOW()) DESC, id DESC
    ) AS rn
  FROM public.goals_master
  WHERE employee_code IS NOT NULL
)
DELETE FROM public.goals_master gm
USING ranked r
WHERE gm.id = r.id
  AND r.rn > 1;

-- Remove history-style partial unique index if present.
DROP INDEX IF EXISTS public.uq_goals_master_active_employee;

-- Enforce single row per employee from now on.
CREATE UNIQUE INDEX IF NOT EXISTS uq_goals_master_employee_code
  ON public.goals_master(employee_code)
  WHERE employee_code IS NOT NULL;

-- Keep lookup index for queries.
CREATE INDEX IF NOT EXISTS idx_goals_master_employee_code
  ON public.goals_master(employee_code);
