CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  class_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  class_name TEXT NOT NULL,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  class_name TEXT NOT NULL,
  due_date TEXT,
  word_target INTEGER,
  ai_policy_note TEXT,
  require_declaration INTEGER NOT NULL DEFAULT 1,
  show_student_evidence INTEGER NOT NULL DEFAULT 0,
  show_student_composition INTEGER NOT NULL DEFAULT 0,
  student_scaffold TEXT DEFAULT '',
  rubric_text TEXT DEFAULT '',
  class_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  final_text TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS writing_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  device_info TEXT
);

CREATE TABLE IF NOT EXISTS draft_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS editor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_meta TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_declarations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  declaration_type TEXT NOT NULL,
  tool_name TEXT,
  prompt_text TEXT,
  original_text_excerpt TEXT,
  student_explanation TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS submission_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  flag_code TEXT NOT NULL,
  flag_message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
