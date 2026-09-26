-- Sync department-level mandatory modules to user_module_assignments.
-- This migration is additive and does not drop tables/columns or delete existing schema.

-- Default window for mandatory assignments.
-- Start at current date and keep active far into the future.
CREATE OR REPLACE FUNCTION public.upsert_user_department_mandatory_modules(
  p_user_id uuid,
  p_department_id integer
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

-- When a department-mandatory module is added/updated/removed,
-- sync all users who belong to that department.
CREATE OR REPLACE FUNCTION public.sync_department_mandatory_modules_to_users_trigger()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
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
      u.id,
      NEW.module_id,
      CURRENT_DATE,
      DATE '2099-12-31',
      'active',
      NOW(),
      NOW()
    FROM public.users u
    WHERE u.department_id = NEW.department_id
    ON CONFLICT (user_id, module_id)
    DO UPDATE SET
      status = 'active',
      start_date = LEAST(public.user_module_assignments.start_date, EXCLUDED.start_date),
      end_date = GREATEST(public.user_module_assignments.end_date, EXCLUDED.end_date),
      updated_at = NOW();

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Remove the module assignment for users of that department
    -- because it is no longer mandated for them.
    DELETE FROM public.user_module_assignments uma
    USING public.users u
    WHERE u.id = uma.user_id
      AND u.department_id = OLD.department_id
      AND uma.module_id = OLD.module_id;

    RETURN OLD;
  END IF;

  -- UPDATE case: remove old mapping effect, then apply new mapping effect.
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.department_id IS DISTINCT FROM NEW.department_id)
      OR (OLD.module_id IS DISTINCT FROM NEW.module_id) THEN

      DELETE FROM public.user_module_assignments uma
      USING public.users u
      WHERE u.id = uma.user_id
        AND u.department_id = OLD.department_id
        AND uma.module_id = OLD.module_id;

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
        u.id,
        NEW.module_id,
        CURRENT_DATE,
        DATE '2099-12-31',
        'active',
        NOW(),
        NOW()
      FROM public.users u
      WHERE u.department_id = NEW.department_id
      ON CONFLICT (user_id, module_id)
      DO UPDATE SET
        status = 'active',
        start_date = LEAST(public.user_module_assignments.start_date, EXCLUDED.start_date),
        end_date = GREATEST(public.user_module_assignments.end_date, EXCLUDED.end_date),
        updated_at = NOW();
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_department_mandatory_modules_to_users
  ON public.department_mandatory_modules;
CREATE TRIGGER trg_sync_department_mandatory_modules_to_users
AFTER INSERT OR UPDATE OR DELETE
ON public.department_mandatory_modules
FOR EACH ROW
EXECUTE FUNCTION public.sync_department_mandatory_modules_to_users_trigger();

-- Keep user assignments aligned when a user is created or moved to another department.
CREATE OR REPLACE FUNCTION public.sync_user_assignments_from_department_trigger()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.upsert_user_department_mandatory_modules(NEW.id, NEW.department_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.department_id IS DISTINCT FROM NEW.department_id THEN
      -- Remove modules that were mandated only by old department.
      IF OLD.department_id IS NOT NULL THEN
        DELETE FROM public.user_module_assignments uma
        WHERE uma.user_id = NEW.id
          AND uma.module_id IN (
            SELECT dmm_old.module_id
            FROM public.department_mandatory_modules dmm_old
            WHERE dmm_old.department_id = OLD.department_id
          )
          AND uma.module_id NOT IN (
            SELECT dmm_new.module_id
            FROM public.department_mandatory_modules dmm_new
            WHERE dmm_new.department_id = NEW.department_id
          );
      END IF;

      PERFORM public.upsert_user_department_mandatory_modules(NEW.id, NEW.department_id);
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_user_assignments_from_department
  ON public.users;
CREATE TRIGGER trg_sync_user_assignments_from_department
AFTER INSERT OR UPDATE OF department_id
ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_assignments_from_department_trigger();

-- Backfill existing users so current data becomes consistent with existing department mappings.
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
  u.id,
  dmm.module_id,
  CURRENT_DATE,
  DATE '2099-12-31',
  'active',
  NOW(),
  NOW()
FROM public.users u
JOIN public.department_mandatory_modules dmm
  ON dmm.department_id = u.department_id
ON CONFLICT (user_id, module_id)
DO UPDATE SET
  status = 'active',
  start_date = LEAST(public.user_module_assignments.start_date, EXCLUDED.start_date),
  end_date = GREATEST(public.user_module_assignments.end_date, EXCLUDED.end_date),
  updated_at = NOW();
