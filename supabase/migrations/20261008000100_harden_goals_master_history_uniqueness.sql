-- Harden goals_master history model for environments that still have legacy
-- UNIQUE(employee_code) definitions.
-- Target model:
-- 1) Multiple historical rows per employee are allowed.
-- 2) Only one active row per employee is allowed (ending_date IS NULL).

DO $$
DECLARE
  c record;
BEGIN
  -- Drop UNIQUE constraints that apply only to employee_code.
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class tbl ON tbl.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = tbl.relnamespace
    WHERE nsp.nspname = 'public'
      AND tbl.relname = 'goals_master'
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 1
      AND con.conkey[1] = (
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = con.conrelid
          AND attname = 'employee_code'
          AND attisdropped = false
      )
  LOOP
    EXECUTE format('ALTER TABLE public.goals_master DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

DO $$
DECLARE
  i record;
BEGIN
  -- Drop non-partial UNIQUE indexes on employee_code left by old/manual setups.
  FOR i IN
    SELECT idx.relname AS index_name
    FROM pg_index ind
    JOIN pg_class idx ON idx.oid = ind.indexrelid
    JOIN pg_class tbl ON tbl.oid = ind.indrelid
    JOIN pg_namespace nsp ON nsp.oid = tbl.relnamespace
    WHERE nsp.nspname = 'public'
      AND tbl.relname = 'goals_master'
      AND ind.indisunique = true
      AND ind.indisprimary = false
      AND ind.indnatts = 1
      AND pg_get_expr(ind.indpred, ind.indrelid) IS NULL
      AND ind.indkey[0] = (
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = ind.indrelid
          AND attname = 'employee_code'
          AND attisdropped = false
      )
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', i.index_name);
  END LOOP;
END $$;

-- Keep lookup index.
CREATE INDEX IF NOT EXISTS idx_goals_master_employee_code
  ON public.goals_master(employee_code);

-- Enforce one active row per employee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_goals_master_active_employee
  ON public.goals_master(employee_code)
  WHERE ending_date IS NULL;
