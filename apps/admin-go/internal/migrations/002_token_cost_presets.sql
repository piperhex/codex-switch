-- Additive migration; existing prices remain untouched on rerun.
CREATE TABLE IF NOT EXISTS public.token_cost_preset_settings (
    id varchar(32) PRIMARY KEY,
    presets jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);