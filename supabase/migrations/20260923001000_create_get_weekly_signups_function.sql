CREATE OR REPLACE FUNCTION public.get_weekly_signups()
RETURNS TABLE (week_index integer, count bigint)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH weekly_signups AS (
    SELECT
      CASE
        WHEN created_at IS NULL THEN NULL
        ELSE 6 - FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / (86400 * 7))::int
      END AS week_index
    FROM public.users
    WHERE created_at >= NOW() - INTERVAL '7 weeks'
  )
  SELECT
    ws.week_index,
    COUNT(*)::bigint AS count
  FROM weekly_signups ws
  WHERE ws.week_index >= 0 AND ws.week_index < 7
  GROUP BY ws.week_index
  ORDER BY ws.week_index ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_weekly_signups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_signups() TO anon;
