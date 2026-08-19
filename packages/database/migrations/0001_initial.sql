CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id uuid PRIMARY KEY,
    email citext UNIQUE,
    display_name text NOT NULL,
    avatar_url text,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id),
    name text NOT NULL,
    slug citext NOT NULL UNIQUE,
    visibility text NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'public')),
    settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE repositories (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('github')),
    provider_repo_id text,
    canonical_url text NOT NULL,
    clone_url text NOT NULL,
    owner_name text NOT NULL,
    repo_name text NOT NULL,
    default_branch text,
    visibility text NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'private')),
    ignore_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
    latest_ready_snapshot_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, canonical_url)
);

CREATE TABLE repository_snapshots (
    id uuid PRIMARY KEY,
    repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha text,
    parent_commit_sha text,
    requested_ref text,
    ref_name text,
    tree_hash text,
    status text NOT NULL CHECK (
        status IN (
            'requested', 'cloning', 'scanning', 'parsing',
            'building_graph', 'embedding', 'ready',
            'failed', 'cancelled'
        )
    ),
    parser_version text NOT NULL,
    index_version integer NOT NULL DEFAULT 1,
    embedding_model text,
    stats_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text,
    error_message text,
    requested_at timestamptz NOT NULL DEFAULT now(),
    ready_at timestamptz,
    failed_at timestamptz
);

CREATE UNIQUE INDEX repository_snapshots_version_uq
    ON repository_snapshots (
        repository_id, commit_sha, parser_version, index_version
    )
    WHERE commit_sha IS NOT NULL;

CREATE INDEX repository_snapshots_recent_idx
    ON repository_snapshots (repository_id, requested_at DESC);

ALTER TABLE repositories
    ADD CONSTRAINT repositories_latest_snapshot_fk
    FOREIGN KEY (latest_ready_snapshot_id)
    REFERENCES repository_snapshots(id)
    ON DELETE SET NULL;

CREATE TABLE content_blobs (
    hash text PRIMARY KEY,
    inline_content text NOT NULL,
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    mime_type text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE snapshot_files (
    id uuid PRIMARY KEY,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    path text NOT NULL,
    blob_hash text NOT NULL REFERENCES content_blobs(hash),
    language text,
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    line_count integer NOT NULL DEFAULT 0 CHECK (line_count >= 0),
    is_generated boolean NOT NULL DEFAULT false,
    is_binary boolean NOT NULL DEFAULT false,
    parse_status text NOT NULL DEFAULT 'pending'
        CHECK (parse_status IN ('pending', 'parsed', 'unsupported', 'failed')),
    parse_error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (snapshot_id, path),
    CHECK (
        path <> ''
        AND path NOT LIKE '/%'
        AND path NOT LIKE '../%'
        AND path NOT LIKE '%/../%'
    )
);

CREATE INDEX snapshot_files_language_idx
    ON snapshot_files (snapshot_id, language);
CREATE INDEX snapshot_files_blob_idx
    ON snapshot_files (blob_hash);
CREATE INDEX snapshot_files_path_trgm_idx
    ON snapshot_files USING gin (path gin_trgm_ops);

CREATE TABLE symbols (
    id uuid PRIMARY KEY,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    snapshot_file_id uuid NOT NULL REFERENCES snapshot_files(id) ON DELETE CASCADE,
    stable_key text NOT NULL,
    kind text NOT NULL CHECK (
        kind IN ('module', 'function', 'class', 'method', 'interface', 'type', 'variable', 'enum')
    ),
    name text NOT NULL,
    qualified_name text,
    signature text,
    start_line integer NOT NULL CHECK (start_line > 0),
    start_column integer NOT NULL DEFAULT 0 CHECK (start_column >= 0),
    end_line integer NOT NULL,
    end_column integer NOT NULL DEFAULT 0 CHECK (end_column >= 0),
    doc_text text,
    content_hash text NOT NULL,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (end_line >= start_line),
    UNIQUE (snapshot_id, stable_key)
);

CREATE INDEX symbols_file_idx ON symbols (snapshot_file_id, start_line);
CREATE INDEX symbols_name_trgm_idx ON symbols USING gin (name gin_trgm_ops);
CREATE INDEX symbols_qualified_name_idx ON symbols (snapshot_id, qualified_name);
CREATE INDEX symbols_kind_idx ON symbols (snapshot_id, kind);

CREATE TABLE symbol_edges (
    id uuid PRIMARY KEY,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    from_symbol_id uuid NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    to_symbol_id uuid REFERENCES symbols(id) ON DELETE CASCADE,
    unresolved_target text,
    relation_type text NOT NULL CHECK (
        relation_type IN (
            'contains', 'imports', 'calls', 'extends',
            'implements', 'exports', 'reads', 'writes'
        )
    ),
    confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    evidence_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (to_symbol_id IS NOT NULL AND unresolved_target IS NULL)
        OR
        (to_symbol_id IS NULL AND unresolved_target IS NOT NULL)
    )
);

CREATE UNIQUE INDEX symbol_edges_resolved_uq
    ON symbol_edges (
        snapshot_id, from_symbol_id, to_symbol_id, relation_type
    )
    WHERE to_symbol_id IS NOT NULL;
CREATE UNIQUE INDEX symbol_edges_unresolved_uq
    ON symbol_edges (
        snapshot_id, from_symbol_id, unresolved_target, relation_type
    )
    WHERE unresolved_target IS NOT NULL;
CREATE INDEX symbol_edges_from_idx
    ON symbol_edges (snapshot_id, from_symbol_id, relation_type);
CREATE INDEX symbol_edges_to_idx
    ON symbol_edges (snapshot_id, to_symbol_id, relation_type)
    WHERE to_symbol_id IS NOT NULL;

CREATE TABLE code_chunks (
    id uuid PRIMARY KEY,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    snapshot_file_id uuid NOT NULL REFERENCES snapshot_files(id) ON DELETE CASCADE,
    symbol_id uuid REFERENCES symbols(id) ON DELETE SET NULL,
    chunk_type text NOT NULL,
    start_line integer NOT NULL CHECK (start_line > 0),
    end_line integer NOT NULL,
    content text NOT NULL,
    content_hash text NOT NULL,
    token_count integer NOT NULL CHECK (token_count >= 0),
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', content)
    ) STORED,
    embedding vector(1536),
    embedding_model text,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (end_line >= start_line)
);

CREATE INDEX code_chunks_search_idx
    ON code_chunks USING gin (search_vector);
CREATE INDEX code_chunks_file_idx
    ON code_chunks (snapshot_file_id, start_line);
CREATE INDEX code_chunks_snapshot_idx
    ON code_chunks (snapshot_id);

CREATE TABLE analysis_jobs (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id uuid REFERENCES repositories(id) ON DELETE CASCADE,
    snapshot_id uuid REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    job_type text NOT NULL,
    status text NOT NULL CHECK (
        status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
    ),
    priority smallint NOT NULL DEFAULT 100,
    progress real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    phase text,
    processed bigint,
    total bigint,
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    lease_owner text,
    lease_expires_at timestamptz,
    idempotency_key text NOT NULL UNIQUE,
    cancel_requested_at timestamptz,
    error_code text,
    error_message text,
    error_details_json jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
);

CREATE INDEX analysis_jobs_claim_idx
    ON analysis_jobs (status, priority, created_at)
    WHERE status IN ('queued', 'running');
CREATE INDEX analysis_jobs_lease_idx
    ON analysis_jobs (lease_expires_at)
    WHERE status = 'running';

CREATE TABLE job_events (
    id bigserial PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    payload_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_events_stream_idx ON job_events (job_id, id);

CREATE TABLE conversations (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    title text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content text NOT NULL,
    answer_status text CHECK (answer_status IN ('grounded', 'partial', 'refused')),
    model_provider text,
    model_name text,
    prompt_version text,
    token_usage_json jsonb,
    latency_ms integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_citations (
    id uuid PRIMARY KEY,
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    snapshot_file_id uuid NOT NULL REFERENCES snapshot_files(id) ON DELETE CASCADE,
    symbol_id uuid REFERENCES symbols(id) ON DELETE SET NULL,
    evidence_id text NOT NULL,
    start_line integer NOT NULL CHECK (start_line > 0),
    end_line integer NOT NULL,
    quote text NOT NULL,
    evidence_hash text NOT NULL,
    retrieval_score real,
    ordinal integer NOT NULL,
    CHECK (end_line >= start_line),
    UNIQUE (message_id, ordinal)
);

CREATE TABLE share_reports (
    id uuid PRIMARY KEY,
    repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    snapshot_id uuid NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    report_type text NOT NULL DEFAULT 'architecture_tour',
    visibility text NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('private', 'unlisted', 'public')),
    content_version integer NOT NULL DEFAULT 1,
    generated_content_json jsonb NOT NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    revoked_at timestamptz
);

INSERT INTO users (id, email, display_name)
VALUES (
    '00000000-0000-7000-8000-000000000001',
    NULL,
    'Public Demo'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (id, owner_id, name, slug, visibility)
VALUES (
    '00000000-0000-7000-8000-000000000002',
    '00000000-0000-7000-8000-000000000001',
    'Public Workspace',
    'public',
    'public'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES (
    '00000000-0000-7000-8000-000000000002',
    '00000000-0000-7000-8000-000000000001',
    'owner'
)
ON CONFLICT (workspace_id, user_id) DO NOTHING;
