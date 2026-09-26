-- Fix type mismatch causing user creation to fail with:
-- "function public.upsert_user_department_mandatory_modules(uuid, bigint) does not exist"
--
-- public.users.department_id is bigint, but the function created in
-- 20260901000200_sync_department_mandatory_to_user_assignments.sql declared
-- p_department_id as integer. The AFTER INSERT trigger on public.users
-- (trg_sync_user_assignments_from_department) calls this function with
-- NEW.department_id (bigint), and Postgres does not implicitly downcast
-- bigint to integer for function overload resolution, so every insert into
-- public.users (i.e. every new user) failed.

DROP FUNCTION IF EXISTS public.upsert_user_department_mandatory_modules(uuid, integer);

CREATE OR REPLACE FUNCTION public.upsert_user_department_mandatory_modules(
  p_user_id uuid,
  p_department_id bigint
)
RETURNS void AS $$
BEGIN
  IF p_user_id IS NULL OR p_department_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_module_assignments (
    user_id,
    module_id,
    start_date,
    end_date,
    status,
    created_at,
    updated_at
  )
  SELECT
    p_user_id,
    dmm.module_id,
    CURRENT_DATE,
    DATE '2099-12-31',
    'active',
    NOW(),
    NOW()
  FROM public.department_mandatory_modules dmm
  WHERE dmm.department_id = p_department_id
  ON CONFLICT (user_id, module_id)
  DO UPDATE SET
    status = 'active',
    start_date = LEAST(public.user_module_assignments.start_date, EXCLUDED.start_date),
    end_date = GREATEST(public.user_module_assignments.end_date, EXCLUDED.end_date),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
