-- Deleted boards and projects go to the trash: hidden everywhere, restorable for
-- 30 days, then removed for good (the purge in main.rs).
ALTER TABLE documents ADD COLUMN deleted_at timestamptz;
ALTER TABLE projects ADD COLUMN deleted_at timestamptz;

-- Projects and boards someone starred (kind: 'project' or 'document').
CREATE TABLE stars (
    user_id     text NOT NULL REFERENCES users ON DELETE CASCADE,
    item_id     text NOT NULL,
    kind        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_id)
);

-- When someone last opened a board, for "Recent" in the sidebar.
CREATE TABLE document_opens (
    user_id     text NOT NULL REFERENCES users ON DELETE CASCADE,
    document_id text NOT NULL REFERENCES documents ON DELETE CASCADE,
    opened_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, document_id)
);
CREATE INDEX document_opens_recent ON document_opens (user_id, opened_at DESC);
