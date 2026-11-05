-- Images on boards. Each belongs to one board: who may see the board may see it.
CREATE TABLE files (
    id          text PRIMARY KEY,
    document_id text NOT NULL REFERENCES documents ON DELETE CASCADE,
    name        text NOT NULL,
    mime        text NOT NULL,
    size        integer NOT NULL,
    data        bytea NOT NULL,
    created_by  text REFERENCES users ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_document ON files (document_id);
