-- Migration 0015: Add classroom_id to classes and index/constraints

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_classes_classroom_id ON classes(classroom_id);

COMMENT ON COLUMN classes.classroom_id IS 'Optional link to classrooms table';

