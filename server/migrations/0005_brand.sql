-- A project's own look for all its boards and their exports: an accent color and
-- a typeface (flow_core::models::Brand), or none for the app's own.
ALTER TABLE projects ADD COLUMN brand jsonb;
