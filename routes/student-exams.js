import express from "express";
import { db } from "../lib/db.js";
import requireStudent from "../middleware/requireStudent.js";

const router = express.Router();

function rowObj(row, keys = []) {
  if (!row) return {};
  if (!Array.isArray(row)) return row;
  const obj = {};
  keys.forEach((k, i) => obj[k] = row[i]);
  return obj;
}

router.get("/:examId", requireStudent, async (req, res) => {
  try {
    const student = req.signedCookies.user;
    const examId = Number(req.params.examId);

    const examResult = await db.execute({
      sql: `
        SELECT e.id, e.title, e.instructions
        FROM exams e
        JOIN students s ON s.class_id = e.class_id
        WHERE e.id = ? AND s.id = ?
      `,
      args: [examId, student.id]
    });

    const exam = rowObj(examResult.rows?.[0], ["id", "title", "instructions"]);
    if (!exam.id) return res.status(404).send("Exam not found");

    let submissionResult = await db.execute({
      sql: `
        SELECT id, status, submitted_at
        FROM exam_submissions
        WHERE exam_id = ? AND student_id = ?
      `,
      args: [examId, student.id]
    });

    let submission = rowObj(submissionResult.rows?.[0], ["id", "status", "submitted_at"]);

    if (!submission.id) {
      const created = await db.execute({
        sql: `
          INSERT INTO exam_submissions (exam_id, student_id, status)
          VALUES (?, ?, 'draft')
          RETURNING id
        `,
        args: [examId, student.id]
      });

      const submissionId = created.rows?.[0]?.id ?? created.rows?.[0]?.[0];

      const questions = await db.execute({
        sql: `SELECT id FROM exam_questions WHERE exam_id = ? ORDER BY id ASC`,
        args: [examId]
      });

      for (const q of questions.rows || []) {
        const questionId = q.id ?? q[0];

        await db.execute({
          sql: `
            INSERT INTO exam_answers (submission_id, question_id, student_answer)
            VALUES (?, ?, '')
          `,
          args: [submissionId, questionId]
        });
      }

      submission = { id: submissionId, status: "draft", submitted_at: null };
    }

    const answersResult = await db.execute({
      sql: `
        SELECT ea.id, ea.student_answer,
               q.question_number, q.question_text, q.max_marks
        FROM exam_answers ea
        JOIN exam_questions q ON q.id = ea.question_id
        WHERE ea.submission_id = ?
        ORDER BY q.id ASC
      `,
      args: [submission.id]
    });

    res.render("exam-student", {
      exam,
      submission,
      answers: (answersResult.rows || []).map(r => rowObj(r, [
        "id", "student_answer", "question_number", "question_text", "max_marks"
      ]))
    });
  } catch (err) {
    console.error("GET /student/exams/:examId error:", err);
    res.status(500).send("Failed to load exam");
  }
});

router.post("/:examId/save", requireStudent, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const { submissionId, answers } = req.body;

    for (const [answerId, studentAnswer] of Object.entries(answers || {})) {
      await db.execute({
        sql: `UPDATE exam_answers SET student_answer = ? WHERE id = ? AND submission_id = ?`,
        args: [studentAnswer || "", answerId, submissionId]
      });
    }

    res.redirect(`/student/exams/${examId}`);
  } catch (err) {
    console.error("POST save student exam error:", err);
    res.status(500).send("Failed to save exam");
  }
});

router.post("/:examId/submit", requireStudent, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const { submissionId, answers } = req.body;

    for (const [answerId, studentAnswer] of Object.entries(answers || {})) {
      await db.execute({
        sql: `UPDATE exam_answers SET student_answer = ? WHERE id = ? AND submission_id = ?`,
        args: [studentAnswer || "", answerId, submissionId]
      });
    }

    await db.execute({
      sql: `
        UPDATE exam_submissions
        SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [submissionId]
    });

    res.redirect("/student/dashboard");
  } catch (err) {
    console.error("POST submit student exam error:", err);
    res.status(500).send("Failed to submit exam");
  }
});

export default router;