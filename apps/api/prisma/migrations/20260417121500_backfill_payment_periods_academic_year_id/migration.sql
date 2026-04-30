UPDATE payment_periods pp
SET academic_year_id = (
  SELECT ay.id
  FROM academic_years ay
  WHERE ay.tenant_id = pp.tenant_id
    AND pp.period_start <= ay.end_date
    AND pp.period_end >= ay.start_date
  ORDER BY (LEAST(pp.period_end, ay.end_date) - GREATEST(pp.period_start, ay.start_date)) DESC,
           ay.start_date DESC
  LIMIT 1
)
WHERE pp.academic_year_id IS NULL;
