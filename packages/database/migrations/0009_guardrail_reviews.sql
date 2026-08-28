-- v1.2: workspace-scoped human review metadata for deterministic Guardrail
-- Findings. The absence of a row represents the unreviewed state.

CREATE TABLE guardrail_reviews (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    snapshot_id uuid NOT NULL,
    finding_id text NOT NULL,
    subject_key text NOT NULL,
    status text NOT NULL CHECK (status IN ('acknowledged', 'accepted_risk', 'false_positive')),
    note text NOT NULL DEFAULT '',
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, snapshot_id)
        REFERENCES repository_snapshots(workspace_id, id) ON DELETE CASCADE,
    UNIQUE (workspace_id, snapshot_id, finding_id),
    CHECK (length(finding_id) BETWEEN 1 AND 300),
    CHECK (subject_key ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (length(note) <= 2000)
);

CREATE INDEX guardrail_reviews_workspace_snapshot_idx
    ON guardrail_reviews (workspace_id, snapshot_id, updated_at DESC, finding_id);
