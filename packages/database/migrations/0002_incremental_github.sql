ALTER TABLE repositories
    ADD COLUMN auto_update_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN github_installation_id bigint,
    ADD COLUMN last_webhook_at timestamptz,
    ADD CONSTRAINT repositories_github_installation_positive_ck
        CHECK (github_installation_id IS NULL OR github_installation_id > 0);

ALTER TABLE repository_snapshots
    ADD COLUMN base_snapshot_id uuid,
    ADD COLUMN index_mode text NOT NULL DEFAULT 'full',
    ADD CONSTRAINT repository_snapshots_base_snapshot_fk
        FOREIGN KEY (base_snapshot_id)
        REFERENCES repository_snapshots(id)
        ON DELETE SET NULL,
    ADD CONSTRAINT repository_snapshots_index_mode_ck
        CHECK (index_mode IN ('full', 'incremental'));

CREATE INDEX repository_snapshots_incremental_base_idx
    ON repository_snapshots (repository_id, parser_version, ready_at DESC)
    WHERE status = 'ready';

CREATE TABLE github_webhook_deliveries (
    delivery_id text PRIMARY KEY,
    event_name text NOT NULL,
    payload_sha256 text NOT NULL,
    status text NOT NULL CHECK (status IN ('enqueued', 'ignored')),
    reason text,
    repository_id uuid REFERENCES repositories(id) ON DELETE SET NULL,
    snapshot_id uuid REFERENCES repository_snapshots(id) ON DELETE SET NULL,
    job_id uuid REFERENCES analysis_jobs(id) ON DELETE SET NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(delivery_id) BETWEEN 1 AND 200),
    CHECK (event_name <> '' AND length(event_name) <= 100),
    CHECK (payload_sha256 ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX github_webhook_deliveries_repository_idx
    ON github_webhook_deliveries (repository_id, received_at DESC)
    WHERE repository_id IS NOT NULL;
