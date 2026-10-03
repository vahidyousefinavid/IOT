CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email          citext NOT NULL UNIQUE,
    full_name      text   NOT NULL,
    password_hash  text   NOT NULL,
    failed_logins  int    NOT NULL DEFAULT 0,
    locked_until   timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- A site is anything that runs one installation: a home, a building or a single machine.
CREATE TABLE sites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('home', 'building', 'machine')),
    timezone    text NOT NULL DEFAULT 'Asia/Tehran',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_members (
    site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, user_id)
);
CREATE INDEX site_members_user_idx ON site_members (user_id);

CREATE TABLE rooms (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name        text NOT NULL,
    icon        text NOT NULL DEFAULT 'sofa',
    sort        int  NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rooms_site_idx ON rooms (site_id, sort);

CREATE TABLE devices (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    room_id       uuid REFERENCES rooms(id) ON DELETE SET NULL,
    -- Devices discovered behind a bridge (e.g. Zigbee2MQTT) point at the bridge.
    parent_id     uuid REFERENCES devices(id) ON DELETE CASCADE,
    name          text  NOT NULL,
    kind          text  NOT NULL,
    protocol      text  NOT NULL,
    external_id   text,
    state         jsonb NOT NULL DEFAULT '{}',
    online        boolean NOT NULL DEFAULT false,
    last_seen     timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (parent_id, external_id)
);
CREATE INDEX devices_site_idx ON devices (site_id);

CREATE TABLE device_credentials (
    device_id    uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    secret_hash  bytea NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz
);

CREATE TABLE refresh_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id    uuid NOT NULL,
    token_hash   bytea NOT NULL UNIQUE,
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    user_agent   text,
    ip           inet,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE telemetry (
    time       timestamptz NOT NULL,
    device_id  uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    key        text NOT NULL,
    value      double precision NOT NULL
);
CREATE INDEX telemetry_device_key_time_idx ON telemetry (device_id, key, time DESC);

CREATE TABLE audit_log (
    id        bigserial PRIMARY KEY,
    at        timestamptz NOT NULL DEFAULT now(),
    user_id   uuid,
    site_id   uuid,
    action    text NOT NULL,
    target    text,
    ip        inet,
    meta      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_site_idx ON audit_log (site_id, at DESC);

-- Use TimescaleDB for telemetry when available; plain PostgreSQL still works.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable('telemetry', 'time', migrate_data => true);
    PERFORM add_retention_policy('telemetry', INTERVAL '365 days');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'timescaledb not available, telemetry stays a plain table';
END $$;
