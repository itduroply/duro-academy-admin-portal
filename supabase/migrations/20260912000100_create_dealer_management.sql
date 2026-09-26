-- Dealer Management
-- Stores dealer/customer master records mapped to the sales representative
-- (employee) who owns the account. This is a new, standalone master table —
-- no existing table held this data in normalized form (dealer/customer
-- fields previously only existed as denormalized columns inside
-- influencer_claim_details and similar transactional tables).

CREATE TABLE IF NOT EXISTS public.dealers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_code text NOT NULL,
  customer_name text NOT NULL,
  sales_rep_name text,
  employee_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dealers_customer_code_unique UNIQUE (customer_code)
);

CREATE INDEX IF NOT EXISTS idx_dealers_employee_id ON public.dealers (employee_id);
CREATE INDEX IF NOT EXISTS idx_dealers_customer_name ON public.dealers (customer_name);

ALTER TABLE public.dealers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow admin and super_admin full access to dealers" ON public.dealers;
CREATE POLICY "Allow admin and super_admin full access to dealers"
ON public.dealers
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

CREATE OR REPLACE FUNCTION public.update_dealers_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_dealers_updated_at ON public.dealers;
CREATE TRIGGER trg_update_dealers_updated_at
BEFORE UPDATE ON public.dealers
FOR EACH ROW
EXECUTE FUNCTION public.update_dealers_updated_at();
