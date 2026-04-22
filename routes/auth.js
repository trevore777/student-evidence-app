import express from "express";
import { db } from "../lib/db.js";
import { comparePassword, hashPassword } from "../lib/auth.js";

const router = express.Router();

function normalizeRow(row, keys = []) {
  if (!row) return {};
  if (!Array.isArray(row)) return row;

  const obj = {};
  keys.forEach((key, i) => {
    obj[key] = row[i];
  });
  return obj;
}

async function getTeachers() {
  const result = await db.execute(`
    SELECT id, name, email
    FROM teachers
    ORDER BY name ASC
  `);

  return (result.rows || []).map((row) =>
    normalizeRow(row, ["id", "name", "email"])
  );
}

router.get("/login", async (req, res) => {
  try {
    const teachers = await getTeachers();
    res.render("login", { error: null, teachers });
  } catch (err) {
    console.error("GET /login error:", err);
    res.status(500).send("Failed to load login page");
  }
});

if (process.env.NODE_ENV !== "production") {
  router.get("/seed-demo-users", async (req, res) => {
    try {
      const teacherHash = await hashPassword("teacher123");

      await db.execute({
        sql: `INSERT OR IGNORE INTO teachers (id, name, email, password_hash, class_name) VALUES (?, ?, ?, ?, ?)`,
        args: [1, "Demo Teacher", "teacher@test.com", teacherHash, "Year 10A"]
      });

      await db.execute({
        sql: `INSERT OR IGNORE INTO teachers (id, name, email, password_hash, class_name) VALUES (?, ?, ?, ?, ?)`,
        args: [2, "Ms Baker", "baker@test.com", teacherHash, "Year 10B"]
      });

      res.send("Demo teachers seeded");
    } catch (err) {
      console.error("GET /seed-demo-users error:", err);
      res.status(500).send("Failed to seed demo users");
    }
  });
}

router.get("/signup", (req, res) => {
  res.render("signup", { error: null });
});

router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.render("signup", {
        error: "All fields are required"
      });
    }

    const existing = await db.execute({
      sql: `SELECT id FROM teachers WHERE email = ?`,
      args: [email]
    });

    if (existing.rows.length > 0) {
      return res.render("signup", {
        error: "Email already in use"
      });
    }

    const passwordHash = await hashPassword(password);

    await db.execute({
      sql: `
        INSERT INTO teachers (name, email, password_hash)
        VALUES (?, ?, ?)
      `,
      args: [name.trim(), email.trim(), passwordHash]
    });

    res.redirect("/login");
  } catch (err) {
    console.error("POST /signup error:", err);
    res.status(500).send("Signup failed");
  }
});

router.get("/join-class", (req, res) => {
  res.render("join-class", { error: null });
});

router.post("/join-class", async (req, res) => {
  try {
    const { joinCode, studentName, studentEmail, studentPin } = req.body;

    if (!joinCode || !studentName || !studentPin) {
      return res.render("join-class", {
        error: "Join code, name, and PIN are required"
      });
    }

    const classResult = await db.execute({
      sql: `
        SELECT id, class_name
        FROM classes
        WHERE join_code = ?
      `,
      args: [String(joinCode).trim()]
    });

    const classRow = normalizeRow(classResult.rows?.[0], ["id", "class_name"]);

    if (!classRow.id) {
      return res.render("join-class", {
        error: "Invalid join code"
      });
    }

    await db.execute({
      sql: `
        INSERT INTO students (class_id, class_name, name, email, student_pin, password_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        classRow.id,
        classRow.class_name,
        studentName.trim(),
        studentEmail?.trim() || "",
        studentPin.trim(),
        "unused"
      ]
    });

    res.redirect("/login");
  } catch (err) {
    console.error("POST /join-class error:", err);
    res.status(500).send("Failed to join class");
  }
});

router.post("/login", async (req, res) => {
  try {
    const { role } = req.body;

    if (role === "teacher") {
      const { email, password } = req.body;

      const result = await db.execute({
        sql: `SELECT id, name, email, password_hash, class_name FROM teachers WHERE email = ?`,
        args: [email]
      });

      const user = normalizeRow(result.rows?.[0], [
        "id",
        "name",
        "email",
        "password_hash",
        "class_name"
      ]);

      if (!user.id) {
        return res.render("login", {
          error: "Invalid login details",
          teachers: await getTeachers()
        });
      }

      const valid = await comparePassword(password, user.password_hash);

      if (!valid) {
        return res.render("login", {
          error: "Invalid login details",
          teachers: await getTeachers()
        });
      }

      res.cookie(
        "user",
        {
          id: user.id,
          name: user.name,
          role: "teacher",
          class_name: user.class_name || ""
        },
        {
          signed: true,
          httpOnly: true,
          sameSite: "strict",
          secure: true
        }
      );

      return res.redirect("/teacher/dashboard");
    }

    const { teacherId, classId, studentId, studentPin } = req.body;

    const result = await db.execute({
      sql: `
        SELECT s.id, s.name, c.class_name, s.student_pin
        FROM students s
        JOIN classes c ON c.id = s.class_id
        WHERE s.id = ? AND s.class_id = ? AND c.teacher_id = ?
      `,
      args: [studentId, classId, teacherId]
    });

    const student = normalizeRow(result.rows?.[0], [
      "id",
      "name",
      "class_name",
      "student_pin"
    ]);

    if (!student.id) {
      return res.render("login", {
        error: "Please select a valid student",
        teachers: await getTeachers()
      });
    }

    if (!student.student_pin || String(student.student_pin) !== String(studentPin || "").trim()) {
      return res.render("login", {
        error: "Invalid student PIN",
        teachers: await getTeachers()
      });
    }

    res.cookie(
      "user",
      {
        id: student.id,
        name: student.name,
        role: "student",
        class_name: student.class_name
      },
      {
        signed: true,
        httpOnly: true,
        sameSite: "strict",
        secure: true
      }
    );

    return res.redirect("/student/dashboard");
  } catch (err) {
    console.error("POST /login error:", err);
    res.status(500).send("Login failed");
  }
});

router.get("/logout", (req, res) => {
  res.clearCookie("user");
  res.redirect("/login");
});

export default router;