import express from "express";
import { db } from "../lib/db.js";
import requireTeacher from "../middleware/requireTeacher.js";

const router = express.Router();

router.get("/new", requireTeacher, (req, res) => {
  res.render("assignment-form", { error: null, values: {} });
});

router.post("/new", requireTeacher, async (req, res) => {
  const teacher = req.signedCookies.user;
  const { title, instructions, class_name, due_date, word_target, ai_policy_note, require_declaration } = req.body;

  if (!title || !instructions || !class_name) {
    return res.render("assignment-form", { error: "Title, instructions, and class are required.", values: req.body });
  }

  await db.execute({
    sql: `
      INSERT INTO assignments (teacher_id, title, instructions, class_name, due_date, word_target, ai_policy_note, require_declaration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      teacher.id,
      title,
      instructions,
      class_name,
      due_date || null,
      word_target ? Number(word_target) : null,
      ai_policy_note || "",
      require_declaration ? 1 : 0
    ]
  });

  res.redirect("/teacher/dashboard");
});

export default router;
