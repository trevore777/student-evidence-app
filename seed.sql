-- =========================
-- TEACHERS
-- Password = teacher123 (bcrypt hash)
-- =========================

INSERT OR IGNORE INTO teachers (id, name, email, password_hash, class_name)
VALUES
(1, 'Demo Teacher', 'teacher@test.com', '$2a$10$u1nYgYk5Z1gkFh8Wl3vC5e9i2sR5pTKtyfPBkO5RAwOB1p5MNDoAu', 'Year 10A'),
(2, 'Ms Baker', 'baker@test.com', '$2a$10$u1nYgYk5Z1gkFh8Wl3vC5e9i2sR5pTKtyfPBkO5RAwOB1p5MNDoAu', 'Year 10B');

-- =========================
-- STUDENTS
-- =========================

INSERT OR IGNORE INTO students (id, name, email, class_name, password_hash)
VALUES
(1, 'Demo Student', 'student@test.com', 'Year 10A', 'unused'),
(2, 'Ella Brown', 'ella@test.com', 'Year 10A', 'unused'),
(3, 'Noah Smith', 'noah@test.com', 'Year 10B', 'unused'),
(4, 'Ruby Jones', 'ruby@test.com', 'Year 10B', 'unused');

-- =========================
-- ASSIGNMENTS
-- =========================

INSERT OR IGNORE INTO assignments
(id, teacher_id, title, instructions, class_name, due_date, word_target, ai_policy_note, require_declaration)
VALUES
(
  1,
  1,
  'AI and Academic Integrity Reflection',
  'Write a reflection explaining how you used AI appropriately in this task.',
  'Year 10A',
  '2026-05-01',
  400,
  'Declare any pasted or AI-assisted content honestly.',
  1
),
(
  2,
  2,
  'Evaluating Sources',
  'Compare two sources and explain which is more reliable.',
  'Year 10B',
  '2026-05-08',
  500,
  'Use the declaration tools if you paste notes or use AI assistance.',
  1
);