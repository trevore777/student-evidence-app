import express from "express";
import { db } from "../lib/db.js";
import requireTeacher from "../middleware/requireTeacher.js";
import { computeFlags, estimateComposition } from "../lib/flags.js";

const router = express.Router();

router.get("/dashboard", requireTeacher, async (req, res) => {
  const teacher = req.signedCookies.user;
  const selectedClass = req.query.class || "";
  const flaggedOnly = req.query.flagged === "1";

  const assignments = await db.execute({
    sql: `SELECT * FROM assignments WHERE teacher_id = ? ORDER BY created_at DESC`,
    args: [teacher.id]
  });

  const submissions = await db.execute({
    sql: `
      SELECT sub.id, sub.status, sub.submitted_at, sub.final_text,
             s.name AS student_name, s.class_name,
             a.title AS assignment_title, a.id AS assignment_id
      FROM submissions sub
      JOIN students s ON s.id = sub.student_id
      JOIN assignments a ON a.id = sub.assignment_id
      WHERE a.teacher_id = ?
      ORDER BY sub.created_at DESC
    `,
    args: [teacher.id]
  });

  let rows = submissions.rows;

  const enriched = [];
  for (const row of rows) {
    const [events, declarations, sessions] = await Promise.all([
      db.execute({ sql: `SELECT * FROM editor_events WHERE submission_id = ? ORDER BY created_at ASC`, args: [row.id] }),
      db.execute({ sql: `SELECT * FROM source_declarations WHERE submission_id = ? ORDER BY created_at ASC`, args: [row.id] }),
      db.execute({ sql: `SELECT * FROM writing_sessions WHERE submission_id = ? ORDER BY started_at ASC`, args: [row.id] })
    ]);

    const flags = computeFlags({
      events: events.rows,
      declarations: declarations.rows,
      sessions: sessions.rows,
      finalText: row.final_text || ""
    });

    enriched.push({ ...row, flags });
  }

  if (selectedClass) enriched.splice(0, enriched.length, ...enriched.filter((r) => r.class_name === selectedClass));
  if (flaggedOnly) enriched.splice(0, enriched.length, ...enriched.filter((r) => r.flags.length > 0));

  const classes = [...new Set(submissions.rows.map((r) => r.class_name))].sort();

  res.render("teacher-dashboard", {
    teacher,
    assignments: assignments.rows,
    submissions: enriched,
    classes,
    selectedClass,
    flaggedOnly
  });
});

router.get("/submission/:id", requireTeacher, async (req, res) => {
  const submissionId = Number(req.params.id);
  const submissionResult = await db.execute({
    sql: `
      SELECT sub.*, s.name AS student_name, s.email AS student_email, s.class_name, a.title AS assignment_title, a.instructions
      FROM submissions sub
      JOIN students s ON s.id = sub.student_id
      JOIN assignments a ON a.id = sub.assignment_id
      WHERE sub.id = ?
    `,
    args: [submissionId]
  });

  const submission = submissionResult.rows[0];
  if (!submission) return res.status(404).send("Submission not found");

  const [sessions, events, declarations, snapshots] = await Promise.all([
    db.execute({ sql: `SELECT * FROM writing_sessions WHERE submission_id = ? ORDER BY started_at ASC`, args: [submissionId] }),
    db.execute({ sql: `SELECT * FROM editor_events WHERE submission_id = ? ORDER BY created_at ASC`, args: [submissionId] }),
    db.execute({ sql: `SELECT * FROM source_declarations WHERE submission_id = ? ORDER BY created_at ASC`, args: [submissionId] }),
    db.execute({ sql: `SELECT * FROM draft_snapshots WHERE submission_id = ? ORDER BY saved_at ASC`, args: [submissionId] })
  ]);

  const analysis = {
    flags: computeFlags({
      events: events.rows,
      declarations: declarations.rows,
      sessions: sessions.rows,
      finalText: submission.final_text || ""
    }),
    composition: estimateComposition({
      events: events.rows,
      declarations: declarations.rows,
      sessions: sessions.rows,
      finalText: submission.final_text || ""
    })
  };

  res.render("teacher-review", {
    submission,
    sessions: sessions.rows,
    events: events.rows,
    declarations: declarations.rows,
    snapshots: snapshots.rows,
    flags: analysis.flags,
    composition: analysis.composition
  });
});

export default router;
