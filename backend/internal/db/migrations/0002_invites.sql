-- Invite codes let an installer configure a site and hand it over to the
-- owner, or let an owner add family members / staff, without either side
-- needing the other's account details.
CREATE TABLE site_invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    code_hash   bytea NOT NULL UNIQUE,
    role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    expires_at  timestamptz NOT NULL,
    used_by     uuid REFERENCES users(id) ON DELETE SET NULL,
    used_at     timestamptz,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_invites_site_idx ON site_invites (site_id, created_at DESC);
