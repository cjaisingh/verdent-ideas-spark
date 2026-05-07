CREATE TABLE public.copilot_settings (
  user_id UUID NOT NULL PRIMARY KEY,
  stt_model TEXT NOT NULL DEFAULT 'nova-3',
  tts_voice TEXT NOT NULL DEFAULT 'aura-2-orion-en',
  language TEXT NOT NULL DEFAULT 'en',
  greeting TEXT NOT NULL DEFAULT 'Copilot ready.',
  ptt_mode BOOLEAN NOT NULL DEFAULT false,
  mic_gain NUMERIC NOT NULL DEFAULT 1.0,
  out_volume NUMERIC NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read own copilot settings"
ON public.copilot_settings FOR SELECT
USING (auth.uid() = user_id AND (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Operators insert own copilot settings"
ON public.copilot_settings FOR INSERT
WITH CHECK (auth.uid() = user_id AND (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Operators update own copilot settings"
ON public.copilot_settings FOR UPDATE
USING (auth.uid() = user_id AND (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')));

CREATE TRIGGER update_copilot_settings_updated_at
BEFORE UPDATE ON public.copilot_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();