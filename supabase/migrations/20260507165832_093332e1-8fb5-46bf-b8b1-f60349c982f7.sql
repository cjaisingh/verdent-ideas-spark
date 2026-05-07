
CREATE OR REPLACE FUNCTION public.awip_rag_search(_q text, _limit int DEFAULT 6)
RETURNS TABLE (
  chunk_id uuid,
  doc_id uuid,
  path text,
  title text,
  heading text,
  content text,
  rank real
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  query tsquery;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  query := websearch_to_tsquery('english', _q);
  RETURN QUERY
  SELECT c.id, d.id, d.path, d.title, c.heading, c.content,
         ts_rank(c.tsv, query) AS rank
  FROM public.awip_doc_chunks c
  JOIN public.awip_docs d ON d.id = c.doc_id
  WHERE c.tsv @@ query
  ORDER BY rank DESC
  LIMIT GREATEST(LEAST(_limit, 20), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.awip_rag_search(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.awip_rag_search(text, int) TO authenticated, service_role;
