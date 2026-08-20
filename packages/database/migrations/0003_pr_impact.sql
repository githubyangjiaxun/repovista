ALTER TABLE repository_snapshots
    ADD COLUMN promote_latest boolean NOT NULL DEFAULT true;

ALTER TABLE analysis_jobs
    ADD COLUMN analysis_id uuid,
    ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE repository_snapshots
    ADD CONSTRAINT repository_snapshots_id_commit_uq UNIQUE (id, commit_sha);

ALTER TABLE snapshot_files
    ADD CONSTRAINT snapshot_files_snapshot_id_id_uq UNIQUE (snapshot_id, id);

ALTER TABLE symbols
    ADD CONSTRAINT symbols_snapshot_id_id_uq UNIQUE (snapshot_id, id);

CREATE TABLE pull_request_analyses (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    provider text NOT NULL DEFAULT 'github' CHECK (provider IN ('github')),
    pr_number integer NOT NULL CHECK (pr_number > 0),
    title text NOT NULL,
    canonical_url text NOT NULL,
    base_sha text NOT NULL CHECK (base_sha ~ '^[a-f0-9]{40}$'),
    head_sha text NOT NULL CHECK (head_sha ~ '^[a-f0-9]{40}$'),
    base_snapshot_id uuid REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    head_snapshot_id uuid REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    parser_version text NOT NULL,
    algorithm_version text NOT NULL,
    provider_files_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    status text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed', 'cancelled')),
    progress real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    stats_json jsonb NOT NULL DEFAULT '{"changedFiles":0,"changedSymbols":0,"directImpacts":0,"transitiveImpacts":0,"unknownImpacts":0,"truncated":false}'::jsonb,
    result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text,
    error_message text,
    error_retryable boolean NOT NULL DEFAULT false,
    idempotency_key text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (repository_id, pr_number, revision)
);

ALTER TABLE analysis_jobs
    ADD CONSTRAINT analysis_jobs_analysis_fk
    FOREIGN KEY (analysis_id) REFERENCES pull_request_analyses(id) ON DELETE CASCADE;

CREATE INDEX analysis_jobs_available_claim_idx
    ON analysis_jobs (status, available_at, priority, created_at)
    WHERE status IN ('queued', 'running');

CREATE INDEX pull_request_analyses_repository_idx
    ON pull_request_analyses (repository_id, pr_number, revision DESC);
CREATE INDEX pull_request_analyses_status_idx
    ON pull_request_analyses (status, updated_at DESC);

CREATE TABLE pull_request_files (
    id uuid PRIMARY KEY,
    analysis_id uuid NOT NULL REFERENCES pull_request_analyses(id) ON DELETE CASCADE,
    path text NOT NULL,
    old_path text,
    change_type text NOT NULL CHECK (change_type IN ('added', 'modified', 'deleted', 'renamed', 'unchanged')),
    base_blob_hash text,
    head_blob_hash text,
    additions integer CHECK (additions IS NULL OR additions >= 0),
    deletions integer CHECK (deletions IS NULL OR deletions >= 0),
    is_binary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (analysis_id, path, change_type),
    CHECK (
        path <> ''
        AND path NOT LIKE '/%'
        AND path NOT LIKE '../%'
        AND path NOT LIKE '%/../%'
        AND (old_path IS NULL OR (
            old_path <> ''
            AND old_path NOT LIKE '/%'
            AND old_path NOT LIKE '../%'
            AND old_path NOT LIKE '%/../%'
        ))
    )
);

CREATE INDEX pull_request_files_analysis_idx
    ON pull_request_files (analysis_id, path);

CREATE TABLE pull_request_symbol_changes (
    id uuid PRIMARY KEY,
    analysis_id uuid NOT NULL REFERENCES pull_request_analyses(id) ON DELETE CASCADE,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    snapshot_side text NOT NULL CHECK (snapshot_side IN ('base', 'head')),
    symbol_id uuid,
    stable_key text NOT NULL,
    path text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    start_line integer NOT NULL CHECK (start_line > 0),
    end_line integer NOT NULL CHECK (end_line >= start_line),
    change_type text NOT NULL CHECK (change_type IN ('added', 'modified', 'deleted', 'moved')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (analysis_id, snapshot_side, stable_key, change_type),
    FOREIGN KEY (snapshot_id, symbol_id)
        REFERENCES symbols(snapshot_id, id) ON DELETE CASCADE
);

CREATE INDEX pull_request_symbol_changes_analysis_idx
    ON pull_request_symbol_changes (analysis_id, snapshot_side, path, start_line);

CREATE TABLE pull_request_impacts (
    id uuid PRIMARY KEY,
    analysis_id uuid NOT NULL REFERENCES pull_request_analyses(id) ON DELETE CASCADE,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    snapshot_side text NOT NULL CHECK (snapshot_side IN ('base', 'head')),
    symbol_id uuid,
    stable_key text NOT NULL,
    path text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    start_line integer NOT NULL CHECK (start_line > 0),
    end_line integer NOT NULL CHECK (end_line >= start_line),
    impact_type text NOT NULL CHECK (impact_type IN ('changed', 'direct', 'transitive', 'unknown')),
    distance integer NOT NULL CHECK (distance >= 0),
    risk_score real NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
    risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    risk_breakdown_json jsonb NOT NULL,
    truncated boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (analysis_id, snapshot_side, stable_key, impact_type),
    FOREIGN KEY (snapshot_id, symbol_id)
        REFERENCES symbols(snapshot_id, id) ON DELETE CASCADE
);

CREATE INDEX pull_request_impacts_order_idx
    ON pull_request_impacts (analysis_id, risk_score DESC, path, start_line, id);

CREATE TABLE pull_request_evidence (
    id uuid PRIMARY KEY,
    stable_id text NOT NULL,
    analysis_id uuid NOT NULL REFERENCES pull_request_analyses(id) ON DELETE CASCADE,
    impact_id uuid NOT NULL REFERENCES pull_request_impacts(id) ON DELETE CASCADE,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    commit_sha text NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40}$'),
    file_id uuid NOT NULL,
    symbol_id uuid,
    path text NOT NULL,
    start_line integer NOT NULL CHECK (start_line > 0),
    end_line integer NOT NULL CHECK (end_line >= start_line),
    quote text NOT NULL,
    content_hash text NOT NULL,
    relation_type text CHECK (relation_type IS NULL OR relation_type IN ('contains', 'imports', 'calls', 'extends', 'implements', 'exports', 'reads', 'writes')),
    algorithm_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (analysis_id, stable_id),
    FOREIGN KEY (snapshot_id, commit_sha)
        REFERENCES repository_snapshots(id, commit_sha) ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, file_id)
        REFERENCES snapshot_files(snapshot_id, id) ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, symbol_id)
        REFERENCES symbols(snapshot_id, id) ON DELETE CASCADE
);

CREATE INDEX pull_request_evidence_analysis_idx
    ON pull_request_evidence (analysis_id, path, start_line);

CREATE TABLE pull_request_impact_paths (
    id uuid PRIMARY KEY,
    impact_id uuid NOT NULL REFERENCES pull_request_impacts(id) ON DELETE CASCADE,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    from_symbol_id uuid,
    to_symbol_id uuid,
    from_stable_key text,
    to_stable_key text,
    from_path text,
    to_path text,
    relation_type text NOT NULL CHECK (relation_type IN ('contains', 'imports', 'calls', 'extends', 'implements', 'exports', 'reads', 'writes')),
    confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    evidence_id uuid REFERENCES pull_request_evidence(id) ON DELETE SET NULL,
    edge_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (impact_id, ordinal),
    FOREIGN KEY (snapshot_id, from_symbol_id)
        REFERENCES symbols(snapshot_id, id) ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, to_symbol_id)
        REFERENCES symbols(snapshot_id, id) ON DELETE CASCADE
);
