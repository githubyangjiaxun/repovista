-- v0.9: immutable, evidence-verified AI explanations for deterministic
-- Guardrail Findings. Raw model responses, provider credentials, client
-- prompts, and complete source files are never persisted here. The verified
-- answer may retain only bounded citation excerpts selected by the server.

ALTER TABLE repository_snapshots
    ADD COLUMN workspace_id uuid;

UPDATE repository_snapshots s
SET workspace_id = r.workspace_id
FROM repositories r
WHERE r.id = s.repository_id;

ALTER TABLE repository_snapshots
    ALTER COLUMN workspace_id SET NOT NULL,
    ADD CONSTRAINT repository_snapshots_workspace_fk
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    ADD CONSTRAINT repository_snapshots_workspace_id_id_uq
        UNIQUE (workspace_id, id);

CREATE TABLE guardrail_explanations (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    snapshot_id uuid NOT NULL,
    finding_id text NOT NULL,
    finding_fingerprint text NOT NULL,
    rule_id text NOT NULL,
    commit_sha text NOT NULL,
    parser_version text NOT NULL,
    algorithm_version text NOT NULL,
    profile_fingerprint text NOT NULL,
    profile_json jsonb,
    finding_json jsonb NOT NULL,
    answer_json jsonb NOT NULL,
    provider text NOT NULL,
    model_name text NOT NULL,
    prompt_version text NOT NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, snapshot_id)
        REFERENCES repository_snapshots(workspace_id, id) ON DELETE CASCADE,
    UNIQUE (
        workspace_id,
        snapshot_id,
        finding_fingerprint,
        provider,
        model_name,
        prompt_version
    ),
    UNIQUE (snapshot_id, id),
    CHECK (length(finding_id) BETWEEN 1 AND 300),
    CHECK (finding_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (rule_id IN (
        'dependency_cycle',
        'large_file',
        'large_symbol',
        'high_fan_in',
        'unresolved_import',
        'parse_failure'
    )),
    CHECK (commit_sha ~ '^[a-f0-9]{7,64}$'),
    CHECK (length(parser_version) BETWEEN 1 AND 200),
    CHECK (length(algorithm_version) BETWEEN 1 AND 100),
    CHECK (profile_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (profile_json IS NULL OR jsonb_typeof(profile_json) = 'object'),
    CHECK (jsonb_typeof(finding_json) = 'object'),
    CHECK (jsonb_typeof(answer_json) = 'object'),
    CHECK (provider IN ('fake', 'ollama', 'openai-compatible')),
    CHECK (length(model_name) BETWEEN 1 AND 200),
    CHECK (length(prompt_version) BETWEEN 1 AND 100)
);

CREATE INDEX guardrail_explanations_workspace_snapshot_idx
    ON guardrail_explanations (workspace_id, snapshot_id, created_at DESC);
