-- A person's inbox: mentioned in a comment (@[Name](user id)), or an answer in a
-- thread they wrote in. Gone with the comment, the board or the person.
CREATE TABLE notifications (
    id            text PRIMARY KEY,
    user_id       text NOT NULL REFERENCES users ON DELETE CASCADE,
    kind          text NOT NULL,                 -- mention | reply
    document_id   text NOT NULL REFERENCES documents ON DELETE CASCADE,
    comment_id    text NOT NULL REFERENCES comments ON DELETE CASCADE,
    actor_name    text NOT NULL,
    excerpt       text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    read_at       timestamptz
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

-- What happened in a project, newest first. Boards are named as they were then;
-- a board deleted for good keeps its history (no foreign key on it).
CREATE TABLE activity (
    id             bigserial PRIMARY KEY,
    project_id     text NOT NULL REFERENCES projects ON DELETE CASCADE,
    actor_user_id  text REFERENCES users ON DELETE SET NULL,
    actor_name     text NOT NULL,
    kind           text NOT NULL,                -- created | edited | renamed | deleted | restored | commented | joined
    document_id    text,
    document_name  text,
    detail         text,
    count          integer NOT NULL DEFAULT 1,   -- edits close together are one entry
    at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_project ON activity (project_id, at DESC);
