CREATE TABLE guardrail_profiles (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    profile_key citext NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    version integer NOT NULL CHECK (version > 0),
    algorithm_version text NOT NULL,
    thresholds_json jsonb NOT NULL,
    fingerprint text NOT NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, profile_key, version),
    UNIQUE (workspace_id, id),
    CHECK (profile_key::text ~ '^[a-z][a-z0-9-]{1,63}$'),
    CHECK (length(name) BETWEEN 1 AND 100),
    CHECK (length(description) <= 500),
    CHECK (length(algorithm_version) BETWEEN 1 AND 100),
    CHECK (jsonb_typeof(thresholds_json) = 'object'),
    CHECK (profile_key <> 'default'),
    CHECK (fingerprint ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX guardrail_profiles_workspace_key_idx
    ON guardrail_profiles (workspace_id, profile_key, version DESC);

ALTER TABLE repositories
    ADD COLUMN guardrail_profile_id uuid;

ALTER TABLE repositories
    ADD CONSTRAINT repositories_guardrail_profile_workspace_fk
    FOREIGN KEY (workspace_id, guardrail_profile_id)
    REFERENCES guardrail_profiles(workspace_id, id)
    ON DELETE RESTRICT;

ALTER TABLE repository_snapshots
    ADD COLUMN guardrail_profile_id uuid REFERENCES guardrail_profiles(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS repository_snapshots_version_uq;

CREATE UNIQUE INDEX repository_snapshots_version_uq
    ON repository_snapshots (
        repository_id,
        commit_sha,
        parser_version,
        index_version,
        (COALESCE(guardrail_profile_id, '00000000-0000-7000-8000-000000000003'::uuid))
    )
    WHERE commit_sha IS NOT NULL;

CREATE INDEX repository_snapshots_guardrail_profile_idx
    ON repository_snapshots (guardrail_profile_id)
    WHERE guardrail_profile_id IS NOT NULL;
