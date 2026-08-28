-- v1.3: workspace notification endpoints and a durable, signed Webhook outbox.
-- Endpoint signing secrets are derived at runtime from NOTIFICATION_SIGNING_SECRET
-- and the endpoint id; no reusable secret is persisted in PostgreSQL.

CREATE TABLE workspace_notification_endpoints (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    url text NOT NULL,
    event_types jsonb NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    CHECK (length(name) BETWEEN 1 AND 100),
    CHECK (length(url) BETWEEN 1 AND 2048),
    CHECK (jsonb_typeof(event_types) = 'array'),
    CHECK (jsonb_array_length(event_types) BETWEEN 1 AND 2)
);

CREATE INDEX workspace_notification_endpoints_workspace_idx
    ON workspace_notification_endpoints (workspace_id, updated_at DESC, id DESC);

CREATE TABLE notification_deliveries (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    endpoint_id uuid NOT NULL,
    event_type text NOT NULL,
    event_key text NOT NULL,
    payload_json jsonb NOT NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 20),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text,
    lease_expires_at timestamptz,
    last_status_code integer CHECK (last_status_code IS NULL OR last_status_code BETWEEN 100 AND 599),
    last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, endpoint_id)
        REFERENCES workspace_notification_endpoints(workspace_id, id) ON DELETE CASCADE,
    UNIQUE (endpoint_id, event_key),
    CHECK (event_type IN ('guardrail_review.updated', 'guardrail_review.cleared')),
    CHECK (jsonb_typeof(payload_json) = 'object'),
    CHECK (lease_expires_at IS NULL OR lease_expires_at > created_at),
    CHECK (delivered_at IS NULL OR delivered_at >= created_at)
);

CREATE INDEX notification_deliveries_claim_idx
    ON notification_deliveries (status, next_attempt_at, created_at)
    WHERE status IN ('queued', 'running');

CREATE INDEX notification_deliveries_workspace_idx
    ON notification_deliveries (workspace_id, created_at DESC, id DESC);

CREATE INDEX notification_deliveries_endpoint_idx
    ON notification_deliveries (endpoint_id, created_at DESC, id DESC);
