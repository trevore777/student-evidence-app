ALTER TABLE assignments ADD COLUMN show_student_evidence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assignments ADD COLUMN show_student_composition INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assignments ADD COLUMN student_scaffold TEXT DEFAULT '';
ALTER TABLE assignments ADD COLUMN rubric_text TEXT DEFAULT '';
ALTER TABLE assignments ADD COLUMN class_id INTEGER;
