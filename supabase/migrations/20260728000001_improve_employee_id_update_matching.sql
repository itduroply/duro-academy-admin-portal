-- Drop the old function
DROP FUNCTION IF EXISTS propagate_employee_id_change(TEXT, TEXT, DATE, TEXT);

-- Recreate the function with improved matching logic
CREATE OR REPLACE FUNCTION propagate_employee_id_change(
  p_old_employee_id TEXT,
  p_new_employee_id TEXT,
  p_date_of_change DATE,
  p_employee_name TEXT
)
RETURNS json AS $$
DECLARE
  v_old TEXT;
  v_new TEXT;
  v_pattern TEXT;
  c_claim INT := 0;
  c_enroll INT := 0;
  c_visit INT := 0;
  c_lead_details INT := 0;
  c_lead_task INT := 0;
  c_m_enroll INT := 0;
  c_tier_upgrade INT := 0;
  c_tele_influencer INT := 0;
  c_monthly_attendance INT := 0;
BEGIN
  v_old := p_old_employee_id;
  v_new := p_new_employee_id;
  v_pattern := '(' || regexp_quote(v_old) || ')(.*)';

  -- Update influencer_claim_details
  update public.influencer_claim_details
     set mapped_isr_code = v_new
   where btrim(mapped_isr_code) = v_old;
  get diagnostics c_claim = row_count;

  -- Update influencer_enrollment_details
  update public.influencer_enrollment_details
     set enrolled_by_dso_code = v_new
   where btrim(enrolled_by_dso_code) = v_old;
  get diagnostics c_enroll = row_count;

  -- Update influencer_visit_reports with improved matching (case-insensitive and trimmed)
  update public.influencer_visit_reports
     set emp_login = v_new
   where LOWER(BTRIM(emp_login)) = LOWER(v_old);
  get diagnostics c_visit = row_count;

  -- Update lead_details_reports
  update public.lead_details_reports
     set lead_created_by = regexp_replace(
       lead_created_by,
       v_pattern,
       v_new || '\1'
     )
   where lead_created_by ~ v_pattern;
  get diagnostics c_lead_details = row_count;

  -- Update lead_task_reports
  update public.lead_task_reports
     set task_created_by_dso_code = v_new
   where btrim(task_created_by_dso_code) = v_old;
  get diagnostics c_lead_task = row_count;

  -- Update m_enrollment_details
  update public.m_enrollment_details
     set mapped_isr = regexp_replace(
       mapped_isr,
       v_pattern,
       v_new || '\1'
     )
   where mapped_isr ~ v_pattern;
  get diagnostics c_m_enroll = row_count;

  -- Update tier_upgrade_performance_report
  update public.tier_upgrade_performance_report
     set mapped_isr = v_new
   where btrim(mapped_isr) = v_old;
  get diagnostics c_tier_upgrade = row_count;

  -- Update telecalling_influencer_wartask
  update public.telecalling_influencer_wartask
     set mapped_isr_code = v_new
   where btrim(mapped_isr_code) = v_old;
  get diagnostics c_tele_influencer = row_count;

  -- Update monthly_attendance_report
  update public.monthly_attendance_report
     set employee_code = v_new
   where btrim(employee_code) = v_old;
  get diagnostics c_monthly_attendance = row_count;

  -- Return summary
  RETURN json_build_object(
    'old_employee_id', v_old,
    'new_employee_id', v_new,
    'date_of_change', p_date_of_change,
    'employee_name', p_employee_name,
    'updated_counts', json_build_object(
      'influencer_claim_details_mapped_isr_code', c_claim,
      'influencer_enrollment_details_enrolled_by_dso_code', c_enroll,
      'influencer_visit_reports_emp_login', c_visit,
      'lead_details_reports_lead_created_by', c_lead_details,
      'lead_task_reports_task_created_by_dso_code', c_lead_task,
      'm_enrollment_details_mapped_isr', c_m_enroll,
      'tier_upgrade_performance_report_mapped_isr', c_tier_upgrade,
      'telecalling_influencer_wartask_mapped_isr_code', c_tele_influencer,
      'monthly_attendance_report_employee_code', c_monthly_attendance
    )
  );
END;
$$ LANGUAGE plpgsql;
