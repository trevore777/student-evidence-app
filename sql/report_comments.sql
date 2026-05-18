CREATE TABLE IF NOT EXISTS report_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  student_id INTEGER,
  assignment_id INTEGER,
  comment_text TEXT NOT NULL,
  rubric_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(submission_id, teacher_id)
);

-- If your table already exists from the previous patch, run this once.
-- It is safe if the column already exists; ignore the duplicate column error.
ALTER TABLE report_comments ADD COLUMN rubric_json TEXT;
