import express from "express";
import { db } from "../lib/db.js";
import { openai } from "../lib/openai.js";
import requireTeacher from "../middleware/requireTeacher.js";

const router = express.Router();

function rowObj(row, keys = []) {
  if (!row) return {};
  if (!Array.isArray(row)) return row;
  const obj = {};
  keys.forEach((k, i) => obj[k] = row[i]);
  return obj;
}

router.get("/new", requireTeacher, async (req, res) => {
  const teacher = req.signedCookies.user;

  const result = await db.execute({
    sql: `SELECT id, class_name FROM classes WHERE teacher_id = ? ORDER BY class_name`,
    args: [teacher.id]
  });

  const classes = (result.rows || []).map(r => rowObj(r, ["id", "class_name"]));

  res.render("exam-create", { classes, error: null });
});

router.post("/new", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const { title, instructions, classId } = req.body;

    if (!title || !classId) {
      const classesResult = await db.execute({
        sql: `SELECT id, class_name FROM classes WHERE teacher_id = ? ORDER BY class_name`,
        args: [teacher.id]
      });

      return res.render("exam-create", {
        classes: (classesResult.rows || []).map(r => rowObj(r, ["id", "class_name"])),
        error: "Title and class are required"
      });
    }

    const result = await db.execute({
      sql: `
        INSERT INTO exams (teacher_id, class_id, title, instructions)
        VALUES (?, ?, ?, ?)
        RETURNING id
      `,
      args: [teacher.id, classId, title, instructions || ""]
    });

    const examId = result.rows?.[0]?.id ?? result.rows?.[0]?.[0];
    res.redirect(`/teacher/exams/${examId}`);
  } catch (err) {
    console.error("POST /teacher/exams/new error:", err);
    res.status(500).send("Failed to create exam");
  }
});

router.get("/:id", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const examId = Number(req.params.id);

    const examResult = await db.execute({
      sql: `
        SELECT id, teacher_id, class_id, title, instructions, created_at
        FROM exams
        WHERE id = ? AND teacher_id = ?
      `,
      args: [examId, teacher.id]
    });

    const exam = rowObj(examResult.rows?.[0], [
      "id", "teacher_id", "class_id", "title", "instructions", "created_at"
    ]);

    if (!exam.id) return res.status(404).send("Exam not found");

    const questionsResult = await db.execute({
      sql: `
        SELECT id, question_number, question_text, answer_guide, max_marks
        FROM exam_questions
        WHERE exam_id = ?
        ORDER BY id ASC
      `,
      args: [examId]
    });

    const submissionsResult = await db.execute({
      sql: `
        SELECT es.id, es.status, es.submitted_at, s.name AS student_name
        FROM exam_submissions es
        JOIN students s ON s.id = es.student_id
        WHERE es.exam_id = ?
        ORDER BY s.name ASC
      `,
      args: [examId]
    });

    res.render("exam-view", {
      exam,
      questions: (questionsResult.rows || []).map(r => rowObj(r, [
        "id", "question_number", "question_text", "answer_guide", "max_marks"
      ])),
      submissions: (submissionsResult.rows || []).map(r => rowObj(r, [
        "id", "status", "submitted_at", "student_name"
      ]))
    });
  } catch (err) {
    console.error("GET /teacher/exams/:id error:", err);
    res.status(500).send("Failed to load exam");
  }
});

router.post("/:id/questions/new", requireTeacher, async (req, res) => {
  try {
    const examId = Number(req.params.id);
    const { questionNumber, questionText, answerGuide, maxMarks } = req.body;

    await db.execute({
      sql: `
        INSERT INTO exam_questions (exam_id, question_number, question_text, answer_guide, max_marks)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        examId,
        questionNumber || "",
        questionText || "",
        answerGuide || "",
        Number(maxMarks || 1)
      ]
    });

    res.redirect(`/teacher/exams/${examId}`);
  } catch (err) {
    console.error("POST /teacher/exams/:id/questions/new error:", err);
    res.status(500).send("Failed to add question");
  }
});

router.get("/:examId/submission/:submissionId", requireTeacher, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const submissionId = Number(req.params.submissionId);

    const submissionResult = await db.execute({
      sql: `
        SELECT es.id, es.exam_id, es.student_id, es.status, es.submitted_at,
               s.name AS student_name, e.title AS exam_title
        FROM exam_submissions es
        JOIN students s ON s.id = es.student_id
        JOIN exams e ON e.id = es.exam_id
        WHERE es.id = ? AND es.exam_id = ?
      `,
      args: [submissionId, examId]
    });

    const submission = rowObj(submissionResult.rows?.[0], [
      "id", "exam_id", "student_id", "status", "submitted_at", "student_name", "exam_title"
    ]);

    const answersResult = await db.execute({
      sql: `
        SELECT ea.id, ea.student_answer, ea.ai_mark, ea.ai_feedback,
               ea.teacher_mark, ea.teacher_feedback,
               q.question_number, q.question_text, q.answer_guide, q.max_marks
        FROM exam_answers ea
        JOIN exam_questions q ON q.id = ea.question_id
        WHERE ea.submission_id = ?
        ORDER BY q.id ASC
      `,
      args: [submissionId]
    });

    res.render("exam-review", {
      submission,
      answers: (answersResult.rows || []).map(r => rowObj(r, [
        "id", "student_answer", "ai_mark", "ai_feedback",
        "teacher_mark", "teacher_feedback",
        "question_number", "question_text", "answer_guide", "max_marks"
      ]))
    });
  } catch (err) {
    console.error("GET exam review error:", err);
    res.status(500).send("Failed to load exam review");
  }
});

router.post("/:examId/submission/:submissionId/mark-ai", requireTeacher, async (req, res) => {
  try {
    if (!openai) return res.status(500).send("AI is not configured");

    const examId = Number(req.params.examId);
    const submissionId = Number(req.params.submissionId);

    const answersResult = await db.execute({
      sql: `
        SELECT ea.id, ea.student_answer,
               q.question_text, q.answer_guide, q.max_marks
        FROM exam_answers ea
        JOIN exam_questions q ON q.id = ea.question_id
        WHERE ea.submission_id = ?
      `,
      args: [submissionId]
    });

    for (const row of answersResult.rows || []) {
      const a = rowObj(row, ["id", "student_answer", "question_text", "answer_guide", "max_marks"]);

      const prompt = `
Mark this exam answer.

Question:
${a.question_text}

Answer guide:
${a.answer_guide}

Student answer:
${a.student_answer}

Maximum marks: ${a.max_marks}

Return only JSON:
{
  "mark": number,
  "feedback": "short student-friendly feedback"
}
`;

      const response = await openai.responses.create({
        model: "gpt-5-mini",
        input: prompt
      });

      let parsed = { mark: 0, feedback: response.output_text || "" };

      try {
        const jsonText = response.output_text.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(jsonText);
      } catch {}

      await db.execute({
        sql: `
          UPDATE exam_answers
          SET ai_mark = ?, ai_feedback = ?
          WHERE id = ?
        `,
        args: [parsed.mark || 0, parsed.feedback || "", a.id]
      });
    }

    res.redirect(`/teacher/exams/${examId}/submission/${submissionId}`);
  } catch (err) {
    console.error("POST AI mark exam error:", err);
    res.status(500).send("Failed to AI mark exam");
  }
});

export default router;