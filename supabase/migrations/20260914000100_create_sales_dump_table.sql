-- Sales Dump
-- Line-item level ERP sales export (Sales Invoice / AR Credit Note /
-- Sales Return / A/R Debit Memo), one row per product line per document.
-- Uploaded through the existing Sales Data Upload screen (ExcelUpload.jsx)
-- as a new "sales_dump" sheet type, alongside the existing influencer /
-- lead / enrollment sheet types that already use public.excel_upload_sessions.
--
-- No natural single-column unique key exists (a Document Number spans
-- multiple product lines), so rows are always inserted, never upserted —
-- same convention already used for lead_task_reports / influencer_visit_reports.

CREATE TABLE IF NOT EXISTS public.sales_dump (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  upload_session_id UUID REFERENCES public.excel_upload_sessions(id) ON DELETE CASCADE,

  document_type TEXT,
  document_number TEXT,
  posting_date DATE,
  document_date DATE,
  sales_order_no TEXT,
  sales_order_date DATE,
  customer_code TEXT,
  customer_name TEXT,
  customer_group TEXT,
  agent_salesman_name TEXT,
  city TEXT,
  state TEXT,
  zone TEXT,
  market_name TEXT,
  cluster_name TEXT,
  type_of_city TEXT,
  billing_branch_name TEXT,
  selling_branch_code TEXT,
  selling_branch TEXT,
  secondary_selling_branch TEXT,
  brand TEXT,
  product_segment_description TEXT,
  subbrand_name TEXT,
  item_code TEXT,
  item_name TEXT,
  sale_account_code TEXT,
  sale_account_description TEXT,
  quantity_pcs NUMERIC,
  uom_code TEXT,
  invoice_rate NUMERIC,
  quantity_na NUMERIC,
  quantity_sqm NUMERIC,
  trade_discount NUMERIC,
  additional_trade_discount NUMERIC,
  special_discount NUMERIC,
  apd1_amount NUMERIC,
  apd2_amount NUMERIC,
  basic_amount NUMERIC,
  cgst_rate NUMERIC,
  cgst_amount NUMERIC,
  sgst_rate NUMERIC,
  sgst_amount NUMERIC,
  igst_rate NUMERIC,
  igst_amount NUMERIC,
  tax_amount NUMERIC,
  net_amount NUMERIC,
  thickness NUMERIC,
  length_name NUMERIC,
  width_name NUMERIC,
  product_group TEXT,
  sub_group_id TEXT,
  sub_group_code TEXT,
  product_subgroup TEXT,
  brand_id TEXT,
  brand_code TEXT,
  segment_id TEXT,
  segment_code TEXT,
  product_segment TEXT,
  general_ledger_code TEXT,
  general_ledger_description TEXT,
  hsn_sac TEXT,
  batch_number TEXT,
  product_master_fa NUMERIC,
  product_master_na NUMERIC,
  month TEXT,
  year INTEGER,
  thickness_id TEXT,
  thickness_code NUMERIC,
  length_code TEXT,
  width_code TEXT,
  ntd_specie_id TEXT,
  ntd_specie_code TEXT,
  ntd_specie_name TEXT,
  grade_id TEXT,
  grade_code TEXT,
  grade_name TEXT,
  subbrand_id TEXT,
  subbrand_code TEXT,
  product_id TEXT,
  product_code TEXT,
  product_name TEXT,
  design_id TEXT,
  design_code TEXT,
  design_name TEXT,
  category_id TEXT,
  category_code TEXT,
  category_name TEXT,
  source_id TEXT,
  source_code TEXT,
  source_name TEXT,
  remarks TEXT,
  group_status TEXT,
  group_grade TEXT,
  group_size TEXT,
  total_weight NUMERIC,
  sales_invoice_no TEXT,
  sales_invoice_date DATE,
  debit_credit_note_type TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_dump_upload_session ON public.sales_dump(upload_session_id);
CREATE INDEX IF NOT EXISTS idx_sales_dump_customer_code ON public.sales_dump(customer_code);
CREATE INDEX IF NOT EXISTS idx_sales_dump_document_number ON public.sales_dump(document_number);
CREATE INDEX IF NOT EXISTS idx_sales_dump_item_code ON public.sales_dump(item_code);
CREATE INDEX IF NOT EXISTS idx_sales_dump_posting_date ON public.sales_dump(posting_date);
CREATE INDEX IF NOT EXISTS idx_sales_dump_document_type ON public.sales_dump(document_type);

ALTER TABLE public.sales_dump ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access on sales_dump" ON public.sales_dump;
CREATE POLICY "Admin full access on sales_dump"
ON public.sales_dump
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid() AND users.role IN ('admin', 'super_admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid() AND users.role IN ('admin', 'super_admin')
  )
);
