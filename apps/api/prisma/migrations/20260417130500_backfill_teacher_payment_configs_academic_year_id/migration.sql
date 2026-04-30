UPDATE teacher_payment_configs tpc
SET academic_year_id = (
  SELECT ay.id
  FROM academic_years ay
  WHERE ay.tenant_id = tpc.tenant_id
    AND tpc.effective_from <= ay.end_date
    AND COALESCE(tpc.effective_to, tpc.effective_from) >= ay.start_date
  ORDER BY (LEAST(COALESCE(tpc.effective_to, tpc.effective_from), ay.end_date) - GREATEST(tpc.effective_from, ay.start_date)) DESC,
           ay.start_date DESC
  LIMIT 1
)
WHERE tpc.academic_year_id IS NULL;
