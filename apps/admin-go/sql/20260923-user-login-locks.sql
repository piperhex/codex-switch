-- Account-scoped state survives application restarts and is shared by all instances.
CREATE TABLE IF NOT EXISTS public.user_login_locks (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
    locked_until timestamptz
);
