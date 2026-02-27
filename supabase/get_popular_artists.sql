-- Function to get most connected artists for the home page
CREATE OR REPLACE FUNCTION get_popular_artists(lim INTEGER DEFAULT 12)
RETURNS TABLE (
  id UUID,
  name TEXT,
  name_ja TEXT,
  image_url TEXT,
  connection_count BIGINT
) AS $$
  SELECT
    a.id,
    a.name,
    a.name_ja,
    a.image_url,
    (
      SELECT COUNT(*) FROM influences i
      WHERE i.influencer_id = a.id OR i.influenced_id = a.id
    ) AS connection_count
  FROM artists a
  WHERE a.name_ja IS NOT NULL
    AND a.image_url IS NOT NULL
  ORDER BY connection_count DESC
  LIMIT lim;
$$ LANGUAGE sql STABLE;
