
-- Knowledge base for Copilot RAG
CREATE TABLE public.awip_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'repo',
  path text NOT NULL UNIQUE,
  title text NOT NULL,
  sha text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.awip_doc_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.awip_docs(id) ON DELETE CASCADE,
  ord int NOT NULL DEFAULT 0,
  heading text,
  content text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(heading,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(content,'')), 'B')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX awip_doc_chunks_tsv_idx ON public.awip_doc_chunks USING GIN (tsv);
CREATE INDEX awip_doc_chunks_doc_idx ON public.awip_doc_chunks (doc_id, ord);

ALTER TABLE public.awip_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.awip_doc_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read awip_docs" ON public.awip_docs
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'));
CREATE POLICY "no client write awip_docs" ON public.awip_docs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "operators read awip_doc_chunks" ON public.awip_doc_chunks
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'));
CREATE POLICY "no client write awip_doc_chunks" ON public.awip_doc_chunks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER awip_docs_updated
  BEFORE UPDATE ON public.awip_docs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
