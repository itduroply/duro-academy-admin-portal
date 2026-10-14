-- Migrate goals_master from legacy quarter-row model to quarter-column model.
-- Adds q1/q2/q3/q4 monthly goal columns, backfills values from existing data,
-- then drops legacy columns: monthly_sheet_goal and quarter.

ALTER TABLE public.goals_master
  ADD COLUMN IF NOT EXISTS q1_monthly_goal NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS q2_monthly_goal NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS q3_monthly_goal NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS q4_monthly_goal NUMERIC DEFAULT 0;

-- Backfill quarter columns using the latest row per employee/quarter.
-- Fallback to latest monthly_sheet_goal when quarter-specific rows are missing.
WITH latest_by_quarter AS (
  SELECT DISTINCT ON (employee_code, UPPER(COALESCE(quarter, '')))
    employee_code,
    UPPER(COALESCE(quarter, '')) AS quarter_key,
    monthly_sheet_goal
  FROM public.goals_master
  WHERE employee_code IS NOT NULL
    AND monthly_sheet_goal IS NOT NULL
  ORDER BY employee_code, UPPER(COALESCE(quarter, '')), COALESCE(updated_at, NOW()) DESC, id DESC
),
latest_fallback AS (
  SELECT DISTINCT ON (employee_code)
    employee_code,
    monthly_sheet_goal
  FROM public.goals_master
  WHERE employee_code IS NOT NULL
    AND monthly_sheet_goal IS NOT NULL
  ORDER BY employee_code, COALESCE(updated_at, NOW()) DESC, id DESC
),
per_employee AS (
  SELECT
    fb.employee_code,
    COALESCE(MAX(CASE WHEN lq.quarter_key = 'Q1' THEN lq.monthly_sheet_goal END), fb.monthly_sheet_goal, 0) AS q1_goal,
    COALESCE(MAX(CASE WHEN lq.quarter_key = 'Q2' THEN lq.monthly_sheet_goal END), fb.monthly_sheet_goal, 0) AS q2_goal,
    COALESCE(MAX(CASE WHEN lq.quarter_key = 'Q3' THEN lq.monthly_sheet_goal END), fb.monthly_sheet_goal, 0) AS q3_goal,
    COALESCE(MAX(CASE WHEN lq.quarter_key = 'Q4' THEN lq.monthly_sheet_goal END), fb.monthly_sheet_goal, 0) AS q4_goal
  FROM latest_fallback fb
  LEFT JOIN latest_by_quarter lq
    ON lq.employee_code = fb.employee_code
  GROUP BY fb.employee_code, fb.monthly_sheet_goal
)
UPDATE public.goals_master gm
SET
  q1_monthly_goal = pe.q1_goal,
  q2_monthly_goal = pe.q2_goal,
  q3_monthly_goal = pe.q3_goal,
  q4_monthly_goal = pe.q4_goal
FROM per_employee pe
WHERE gm.employee_code = pe.employee_code;

-- Keep legacy quarter index for now for backward compatibility.

-- Keep legacy columns for now because mobile clients still rely on them.
-- We'll drop `monthly_sheet_goal` and `quarter` in a later migration
-- after mobile is migrated to q1/q2/q3/q4 columns.

-- Helpful indexes for quarter columns.
CREATE INDEX IF NOT EXISTS idx_goals_master_q1_monthly_goal ON public.goals_master(q1_monthly_goal);
CREATE INDEX IF NOT EXISTS idx_goals_master_q2_monthly_goal ON public.goals_master(q2_monthly_goal);
CREATE INDEX IF NOT EXISTS idx_goals_master_q3_monthly_goal ON public.goals_master(q3_monthly_goal);
CREATE INDEX IF NOT EXISTS idx_goals_master_q4_monthly_goal ON public.goals_master(q4_monthly_goal);
