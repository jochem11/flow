-- Saved states of a board: by hand (with a name) and automatically while it is
-- being changed (at most one per half hour; the oldest automatic ones go).
CREATE TABLE document_versions (
    id          text PRIMARY KEY,
    document_id text NOT NULL REFERENCES documents ON DELETE CASCADE,
    name        text,
    content     jsonb NOT NULL,
    created_by  text REFERENCES users ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_versions_document ON document_versions (document_id, created_at DESC);

-- Boards someone saved to start new boards from (their own).
CREATE TABLE templates (
    id          text PRIMARY KEY,
    owner_id    text NOT NULL REFERENCES users ON DELETE CASCADE,
    name        text NOT NULL,
    kind        text NOT NULL,
    content     jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX templates_owner ON templates (owner_id, created_at DESC);
