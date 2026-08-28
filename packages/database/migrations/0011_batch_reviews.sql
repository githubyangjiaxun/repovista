-- v1.4: atomic Guardrail Review batches and provider-specific notification snapshots.

ALTER TABLE workspace_notification_endpoints
    ADD COLUMN IF NOT EXISTS adapter text NOT NULL DEFAULT 'generic';

ALTER TABLE workspace_notification_endpoints
    DROP CONSTRAINT IF EXISTS workspace_notification_endpoints_event_types_check;

ALTER TABLE workspace_notification_endpoints
    DROP CONSTRAINT IF EXISTS workspace_notification_endpoints_event_types_check1;

ALTER TABLE workspace_notification_endpoints
    ADD CONSTRAINT workspace_notification_endpoints_adapter_check
        CHECK (adapter IN ('generic', 'slack'));

ALTER TABLE workspace_notification_endpoints
    ADD CONSTRAINT workspace_notification_endpoints_event_types_v14_check
        CHECK (jsonb_typeof(event_types) = 'array' AND jsonb_array_length(event_types) BETWEEN 1 AND 3);

ALTER TABLE notification_deliveries
    ADD COLUMN IF NOT EXISTS adapter text NOT NULL DEFAULT 'generic';

ALTER TABLE notification_deliveries
    DROP CONSTRAINT IF EXISTS notification_deliveries_event_type_check;

ALTER TABLE notification_deliveries
    ADD CONSTRAINT notification_deliveries_adapter_check
        CHECK (adapter IN ('generic', 'slack'));

ALTER TABLE notification_deliveries
    ADD CONSTRAINT notification_deliveries_event_type_v14_check
        CHECK (event_type IN ('guardrail_review.updated', 'guardrail_review.cleared', 'guardrail_review.batch_updated'));

CREATE TABLE guardrail_review_batches (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    result_json jsonb NOT NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, snapshot_id)
        REFERENCES repository_snapshots(workspace_id, id) ON DELETE CASCADE,
    UNIQUE (workspace_id, snapshot_id, idempotency_key),
    CHECK (length(idempotency_key) BETWEEN 1 AND 200),
    CHECK (idempotency_key !~ '[[:cntrl:]]'),
    CHECK (idempotency_key !~ '[^ -~]'),
    CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (jsonb_typeof(result_json) = 'object'),
    CHECK (octet_length(result_json::text) <= 100000)
);

CREATE INDEX guardrail_review_batches_workspace_created_idx
    ON guardrail_review_batches (workspace_id, created_at DESC, id DESC);

CREATE INDEX guardrail_review_batches_snapshot_created_idx
    ON guardrail_review_batches (snapshot_id, created_at DESC, id DESC);
