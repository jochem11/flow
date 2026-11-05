-- Accounts, projects with their documents, and who may do what with them.
-- Ids are text: documents keep the ids they had in the desktop app, because
-- other documents (kanban card links) refer to them.

CREATE TABLE users (
    id                text PRIMARY KEY,
    email             text NOT NULL UNIQUE,      -- stored lowercase
    name              text NOT NULL,
    avatar_url        text,
    password_hash     text,                      -- argon2id; null for Google-only accounts
    google_sub        text UNIQUE,
    email_verified_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Logged-in devices. Only a hash of the token is stored.
CREATE TABLE sessions (
    token_hash  text PRIMARY KEY,
    user_id     text NOT NULL REFERENCES users ON DELETE CASCADE,
    user_agent  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- One-time tokens sent by mail ('verify', 'reset') or handed to the desktop app ('login').
CREATE TABLE one_time_tokens (
    token_hash  text PRIMARY KEY,
    purpose     text NOT NULL,
    user_id     text NOT NULL REFERENCES users ON DELETE CASCADE,
    payload     text,                            -- for 'login': the session token
    expires_at  timestamptz NOT NULL
);

-- Google sign-in in progress: the state sent to Google, and the PKCE verifier.
CREATE TABLE oauth_states (
    state       text PRIMARY KEY,
    verifier    text NOT NULL,
    client      text NOT NULL,                   -- 'web' or 'desktop'
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    id          text PRIMARY KEY,
    owner_id    text NOT NULL REFERENCES users,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    folders     jsonb NOT NULL DEFAULT '[]',
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Everyone in a project, the owner included. role: owner | editor | commenter | viewer | none
-- ('none': only invited to some boards of it).
CREATE TABLE project_members (
    project_id    text NOT NULL REFERENCES projects ON DELETE CASCADE,
    user_id       text NOT NULL REFERENCES users ON DELETE CASCADE,
    role          text NOT NULL,
    sidebar_order double precision NOT NULL DEFAULT 1,
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user ON project_members (user_id);

CREATE TABLE documents (
    id          text PRIMARY KEY,
    project_id  text NOT NULL REFERENCES projects ON DELETE CASCADE,
    folder_id   text,
    sort_order  double precision NOT NULL,
    name        text NOT NULL,
    kind        text NOT NULL,
    content     jsonb NOT NULL,                  -- the document as JSON (DocContent)
    ydoc        bytea,                           -- the live co-editing state (Yjs), once edited together
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_project ON documents (project_id);

-- A board's own role for someone, instead of their project role ('none' hides it).
CREATE TABLE document_roles (
    document_id text NOT NULL REFERENCES documents ON DELETE CASCADE,
    user_id     text NOT NULL REFERENCES users ON DELETE CASCADE,
    role        text NOT NULL,
    PRIMARY KEY (document_id, user_id)
);

CREATE TABLE invites (
    id          text PRIMARY KEY,
    project_id  text NOT NULL REFERENCES projects ON DELETE CASCADE,
    document_id text REFERENCES documents ON DELETE CASCADE,  -- set: an invite to this board only
    email       text NOT NULL,
    role        text NOT NULL,
    token_hash  text NOT NULL UNIQUE,
    invited_by  text NOT NULL REFERENCES users ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    accepted_at timestamptz
);
CREATE INDEX invites_email ON invites (email);

-- One public link per board. access: restricted | view | comment
CREATE TABLE share_links (
    document_id text PRIMARY KEY REFERENCES documents ON DELETE CASCADE,
    token       text NOT NULL UNIQUE,
    access      text NOT NULL DEFAULT 'restricted',
    created_by  text NOT NULL REFERENCES users ON DELETE CASCADE
);

-- People without an account who opened a link that allows comments.
CREATE TABLE guests (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comments (
    id             text PRIMARY KEY,
    document_id    text NOT NULL REFERENCES documents ON DELETE CASCADE,
    parent_id      text REFERENCES comments ON DELETE CASCADE,
    anchor         jsonb NOT NULL,
    body           text NOT NULL,
    author_user_id text REFERENCES users ON DELETE SET NULL,
    guest_id       text REFERENCES guests ON DELETE SET NULL,
    author_name    text NOT NULL,                -- kept for guests and deleted accounts
    created_at     timestamptz NOT NULL DEFAULT now(),
    edited_at      timestamptz,
    resolved_at    timestamptz
);
CREATE INDEX comments_document ON comments (document_id);
