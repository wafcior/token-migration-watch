
CREATE TABLE public.migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mint_address text UNIQUE NOT NULL,
  name text,
  symbol text,
  image_url text,
  migrated_at timestamptz NOT NULL,
  market_cap numeric,
  tx_signature text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.migrations TO anon, authenticated;
GRANT ALL ON public.migrations TO service_role;
ALTER TABLE public.migrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read migrations" ON public.migrations FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX migrations_migrated_at_idx ON public.migrations (migrated_at DESC);

CREATE TABLE public.sync_state (
  id integer PRIMARY KEY DEFAULT 1,
  last_signature text,
  last_run_at timestamptz,
  last_run_status text,
  CONSTRAINT sync_state_singleton CHECK (id = 1)
);
GRANT ALL ON public.sync_state TO service_role;
-- intentionally no anon/authenticated grants; frontend reads via a public server fn that selects safe columns
ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;
-- allow anon read for the last_run_at indicator only via narrow policy
GRANT SELECT ON public.sync_state TO anon, authenticated;
CREATE POLICY "Public can read sync state" ON public.sync_state FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.sync_state (id, last_signature, last_run_at, last_run_status) VALUES (1, NULL, NULL, NULL);
