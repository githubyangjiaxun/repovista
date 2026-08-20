-- v0.4: versioned, Snapshot-scoped embedding indexes.
-- The legacy code_chunks.embedding column remains untouched for v0.1-v0.3
-- compatibility. New code reads and writes only the tables below.

ALTER TABLE code_chunks
    ADD CONSTRAINT code_chunks_snapshot_id_id_uq
    UNIQUE (snapshot_id, id);

CREATE TABLE snapshot_embedding_indexes (
    id uuid PRIMARY KEY,
    snapshot_id uuid NOT NULL,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('ollama', 'openai-compatible')),
    model text NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
    input_version text NOT NULL CHECK (length(input_version) BETWEEN 1 AND 100),
    status text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed', 'cancelled')),
    dimensions integer CHECK (dimensions IS NULL OR dimensions BETWEEN 1 AND 16000),
    total_chunks integer NOT NULL DEFAULT 0 CHECK (total_chunks >= 0),
    embedded_chunks integer NOT NULL DEFAULT 0 CHECK (embedded_chunks >= 0),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    error_code text,
    error_message text,
    error_retryable boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    ready_at timestamptz,
    failed_at timestamptz,
    FOREIGN KEY (snapshot_id)
        REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE,
    UNIQUE (id, snapshot_id),
    UNIQUE (snapshot_id, provider, model, input_version),
    CHECK (embedded_chunks <= total_chunks),
    CHECK (status <> 'ready' OR embedded_chunks = total_chunks),
    CHECK (status <> 'ready' OR dimensions IS NOT NULL OR total_chunks = 0)
);

CREATE INDEX snapshot_embedding_indexes_snapshot_idx
    ON snapshot_embedding_indexes (snapshot_id, created_at DESC);
CREATE INDEX snapshot_embedding_indexes_status_idx
    ON snapshot_embedding_indexes (status, updated_at);

CREATE TABLE code_chunk_embeddings (
    embedding_index_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    code_chunk_id uuid NOT NULL,
    content_hash text NOT NULL,
    input_hash text NOT NULL,
    dimensions integer NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
    embedding vector NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (embedding_index_id, code_chunk_id),
    FOREIGN KEY (embedding_index_id, snapshot_id)
        REFERENCES snapshot_embedding_indexes(id, snapshot_id) ON DELETE CASCADE,
    FOREIGN KEY (code_chunk_id, snapshot_id)
        REFERENCES code_chunks(id, snapshot_id) ON DELETE CASCADE,
    CHECK (vector_dims(embedding) = dimensions)
);

CREATE INDEX code_chunk_embeddings_snapshot_idx
    ON code_chunk_embeddings (embedding_index_id, snapshot_id, code_chunk_id);

ALTER TABLE analysis_jobs
    ADD COLUMN embedding_index_id uuid;

ALTER TABLE analysis_jobs
    ADD CONSTRAINT analysis_jobs_embedding_index_fk
    FOREIGN KEY (embedding_index_id) REFERENCES snapshot_embedding_indexes(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX analysis_jobs_embedding_index_uq
    ON analysis_jobs (embedding_index_id)
    WHERE embedding_index_id IS NOT NULL;

ALTER TABLE analysis_jobs
    ADD CONSTRAINT analysis_jobs_embedding_job_shape_ck
    CHECK (
      job_type <> 'embed_snapshot'
      OR (embedding_index_id IS NOT NULL AND snapshot_id IS NOT NULL AND repository_id IS NOT NULL)
    );
