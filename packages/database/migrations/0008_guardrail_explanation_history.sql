-- v1.0: deterministic cross-snapshot identity for immutable Guardrail
-- explanations. The key is derived only from the persisted server-owned
-- Finding. It is a lookup aid, never an authorization boundary.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE guardrail_explanations
    ADD COLUMN subject_key text;

UPDATE guardrail_explanations
SET subject_key = 'sha256:' || encode(
    digest(
        CASE rule_id
            WHEN 'dependency_cycle' THEN
                array_to_json(ARRAY[
                    rule_id,
                    COALESCE(
                        finding_json->'metric'->>'packages',
                        finding_json->>'message'
                    )
                ]::text[])::text
            WHEN 'large_file' THEN
                array_to_json(ARRAY[
                    rule_id,
                    finding_json->>'path'
                ]::text[])::text
            WHEN 'parse_failure' THEN
                array_to_json(ARRAY[
                    rule_id,
                    finding_json->>'path'
                ]::text[])::text
            WHEN 'large_symbol' THEN
                array_to_json(ARRAY[
                    rule_id,
                    finding_json->>'path',
                    COALESCE(
                        finding_json->'metric'->>'symbol',
                        finding_json->>'message'
                    )
                ]::text[])::text
            WHEN 'high_fan_in' THEN
                array_to_json(ARRAY[
                    rule_id,
                    finding_json->>'path',
                    COALESCE(
                        finding_json->'metric'->>'symbol',
                        finding_json->>'message'
                    )
                ]::text[])::text
            WHEN 'unresolved_import' THEN
                array_to_json(ARRAY[
                    rule_id,
                    finding_json->>'path',
                    finding_json->>'startLine',
                    COALESCE(
                        finding_json->'metric'->>'target',
                        finding_json->>'message'
                    )
                ]::text[])::text
        END,
        'sha256'
    ),
    'hex'
);

ALTER TABLE guardrail_explanations
    ALTER COLUMN subject_key SET NOT NULL,
    ADD CONSTRAINT guardrail_explanations_subject_key_check
        CHECK (subject_key ~ '^sha256:[a-f0-9]{64}$');

CREATE INDEX guardrail_explanations_subject_history_idx
    ON guardrail_explanations (
        workspace_id,
        subject_key,
        created_at DESC,
        id DESC
    );
