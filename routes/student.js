import express from "express";
import { db } from "../lib/db.js";
import requireStudent from "../middleware/requireStudent.js";

const router = express.Router();

router.get("/dashboard", requireStudent, async (req, res) => {
  const student = req.signedCookies.user;
  const result = await db.execute({
    sql: `
      SELECT a.*, sub.id AS submission_id, sub.status, sub.submitted_at,
             (SELECT MAX(saved_at) FROM draft_snapshots ds WHERE ds.submission_id = sub.id) AS last_saved,
             (SELECT COUNT(*) FROM writing_sessions ws WHERE ws.submission_id = sub.id) AS session_count,
             (SELECT COUNT(*) FROM source_declarations sd WHERE sd.submission_id = sub.id) AS declaration_count,
             (SELECT COUNT(*) FROM draft_snapshots ds2 WHERE ds2.submission_id = sub.id) AS snapshot_count,
             COALESCE(LENGTH(sub.final_text), 0) AS char_count
      FROM assignments a
      JOIN students s ON s.class_name = a.class_name
      LEFT JOIN submissions sub ON sub.assignment_id = a.id AND sub.student_id = s.id
      WHERE s.id = ?
      ORDER BY a.created_at DESC
    `,
    args: [student.id]
  });

  res.render("student-dashboard", { student, assignments: result.rows });
});

router.get("/assignment/:id", requireStudent, async (req, res) => {
  const student = req.signedCookies.user;
  const assignmentId = Number(req.params.id);

  const assignmentResult = await db.execute({ sql: `SELECT * FROM assignments WHERE id = ?`, args: [assignmentId] });
  const assignment = assignmentResult.rows[0];
  if (!assignment) return res.status(404).send("Assignment not found");

  let submissionResult = await db.execute({
    sql: `SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`,
    args: [assignmentId, student.id]
  });
  let submission = submissionResult.rows[0];

  if (!submission) {
    await db.execute({
      sql: `INSERT INTO submissions (assignment_id, student_id, final_text, status) VALUES (?, ?, '', 'draft')`,
      args: [assignmentId, student.id]
    });
    submissionResult = await db.execute({
      sql: `SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`,
      args: [assignmentId, student.id]
    });
    submission = submissionResult.rows[0];
  }

  const latestDraft = await db.execute({
    sql: `SELECT * FROM draft_snapshots WHERE submission_id = ? ORDER BY saved_at DESC LIMIT 1`,
    args: [submission.id]
  });

  res.render("writing", {
    student,
    assignment,
    submission,
    latestContent: latestDraft.rows[0]?.content || submission.final_text || ""
  });
});

export default router;
