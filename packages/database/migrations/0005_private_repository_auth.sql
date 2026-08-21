-- v0.5: first-party authentication, workspace isolation, GitHub App installations,
-- and append-only audit events. No raw session, OAuth, API, or installation token
-- is persisted by this migration or the application code that uses it.

ALTER TABLE workspaces
    ADD COLUMN kind text NOT NULL DEFAULT 'team',
    ADD CONSTRAINT workspaces_kind_ck
        CHECK (kind IN ('public', 'personal', 'team'));

UPDATE workspaces
SET kind = 'public'
WHERE id = '00000000-0000-7000-8000-000000000002';

CREATE UNIQUE INDEX workspaces_personal_owner_uq
    ON workspaces (owner_id)
    WHERE kind = 'personal';

CREATE TABLE user_identities (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('github')),
    provider_user_id text NOT NULL,
    login citext NOT NULL,
    profile_url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id),
    UNIQUE (provider, login),
    CHECK (provider_user_id ~ '^[1-9][0-9]*$'),
    CHECK (profile_url ~ '^https://github\.com/[A-Za-z0-9-]+/?$')
);

CREATE INDEX user_identities_user_idx
    ON user_identities (user_id, provider);

CREATE TABLE oauth_login_states (
    state_hash text PRIMARY KEY,
    return_to text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (state_hash ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (return_to LIKE '/%' AND return_to NOT LIKE '//%' AND return_to !~ '[\\]'),
    CHECK (expires_at > created_at)
);

CREATE INDEX oauth_login_states_expiry_idx
    ON oauth_login_states (expires_at);

CREATE TABLE github_installation_states (
    state_hash text PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    return_to text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE,
    CHECK (state_hash ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (return_to LIKE '/%' AND return_to NOT LIKE '//%' AND return_to !~ '[\\]'),
    CHECK (expires_at > created_at)
);

CREATE INDEX github_installation_states_expiry_idx
    ON github_installation_states (expires_at);

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    token_hash text NOT NULL UNIQUE,
    csrf_token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (active_workspace_id, user_id)
        REFERENCES workspace_members(workspace_id, user_id) ON DELETE RESTRICT,
    CHECK (token_hash ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (csrf_token_hash ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (expires_at > created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX auth_sessions_user_idx
    ON auth_sessions (user_id, created_at DESC);
CREATE INDEX auth_sessions_expiry_idx
    ON auth_sessions (expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE api_tokens (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    token_prefix text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    scopes_json jsonb NOT NULL,
    expires_at timestamptz,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, created_by)
        REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE,
    CHECK (length(name) BETWEEN 1 AND 100),
    CHECK (token_prefix ~ '^rv_[A-Za-z0-9_-]{8}$'),
    CHECK (token_hash ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (jsonb_typeof(scopes_json) = 'array'),
    CHECK (expires_at IS NULL OR expires_at > created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX api_tokens_workspace_idx
    ON api_tokens (workspace_id, created_at DESC);
CREATE INDEX api_tokens_active_idx
    ON api_tokens (expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE github_installations (
    installation_id bigint PRIMARY KEY CHECK (installation_id > 0),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_id bigint NOT NULL CHECK (account_id > 0),
    account_login citext NOT NULL,
    account_type text NOT NULL CHECK (account_type IN ('User', 'Organization')),
    repository_selection text NOT NULL CHECK (repository_selection IN ('all', 'selected')),
    permissions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    installed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    suspended_at timestamptz,
    last_synced_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, installation_id),
    CHECK (length(account_login::text) BETWEEN 1 AND 100),
    CHECK (jsonb_typeof(permissions_json) = 'object')
);

CREATE INDEX github_installations_workspace_idx
    ON github_installations (workspace_id, account_login);

-- v0.4 could retain an informational installation id for a public webhook even
-- though it had no installation credential model. Clear those unverified values
-- before turning the column into a real foreign key.
UPDATE repositories SET github_installation_id = NULL
WHERE github_installation_id IS NOT NULL;

ALTER TABLE repositories
    ADD CONSTRAINT repositories_workspace_id_id_uq UNIQUE (workspace_id, id),
    ADD CONSTRAINT repositories_github_installation_fk
        FOREIGN KEY (github_installation_id)
        REFERENCES github_installations(installation_id)
        ON DELETE SET NULL;

CREATE UNIQUE INDEX repositories_provider_repo_workspace_uq
    ON repositories (workspace_id, provider, provider_repo_id)
    WHERE provider_repo_id IS NOT NULL;

ALTER TABLE github_webhook_deliveries
    ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE github_webhook_deliveries
    DROP CONSTRAINT github_webhook_deliveries_status_check,
    ADD CONSTRAINT github_webhook_deliveries_status_check
        CHECK (status IN ('enqueued', 'ignored', 'synchronized'));

CREATE INDEX github_webhook_deliveries_workspace_idx
    ON github_webhook_deliveries (workspace_id, received_at DESC)
    WHERE workspace_id IS NOT NULL;

CREATE INDEX share_reports_repository_visibility_idx
    ON share_reports (repository_id, visibility, created_at DESC);

CREATE TABLE audit_events (
    id bigserial PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    actor_kind text NOT NULL
        CHECK (actor_kind IN ('anonymous', 'session', 'token', 'github', 'system')),
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (action ~ '^[a-z][a-z0-9_.-]{2,99}$'),
    CHECK (resource_type ~ '^[a-z][a-z0-9_.-]{1,49}$'),
    CHECK (length(resource_id) BETWEEN 1 AND 300),
    CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX audit_events_workspace_idx
    ON audit_events (workspace_id, created_at DESC, id DESC);
