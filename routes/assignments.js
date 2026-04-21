import express from "express";
import { db } from "../lib/db.js";
import requireTeacher from "../middleware/requireTeacher.js";

const router = express.Router();

router.get("/new", requireTeacher, (req, res) => {
  const teacher = req.signedCookies.user;
  res.render("assignment-form", { error: null, values: { class_name: teacher.class_name || "" }, teacher });
});

router.post("/new", requireTeacher, async (req, res) => {
  const teacher = req.signedCookies.user;
  const { title, instructions, due_date, word_target, ai_policy_note, require_declaration } = req.body;
  const class_name = teacher.class_name || req.body.class_name;

  if (!title || !instructions || !class_name) {
    return res.render("assignment-form", { error: "Title, instructions, and class are required.", values: { ...req.body, class_name }, teacher });
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
