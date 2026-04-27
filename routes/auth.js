import express from "express";
import { db } from "../lib/db.js";
import { hashPassword, comparePassword } from "../lib/auth.js";

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

/* LOGIN PAGE */
router.get("/login", async (req, res) => {
  try {
    const teachers = await getTeachers();

    res.render("login", {
      error: null,
      teachers
    });
  } catch (err) {
    console.error("GET /login error:", err);
    res.status(500).send("Failed to load login page");
  }
});

/* SIGNUP PAGE */
router.get("/signup", (req, res) => {
  res.render("signup", {
    error: null
  });
});

/* CREATE TEACHER ACCOUNT */
router.post("/signup", async (req, res) => {
  try {
    const body = req.body || {};
    const { name, email, password, className } = body;

    if (!name || !email || !password) {
      return res.render("signup", {
        error: "All fields are required"
      });
    }

    const existing = await db.execute({
      sql: `
        SELECT id
        FROM teachers
        WHERE email = ?
      `,
      args: [email.trim()]
    });

    if (existing.rows.length > 0) {
      return res.render("signup", {
        error: "Email already exists"
      });
    }

    const passwordHash = await hashPassword(password);

    const teacherResult = await db.execute({
      sql: `
        INSERT INTO teachers (
          name,
          email,
          password_hash,
          plan,
          subscription_status
        )
        VALUES (?, ?, ?, 'free', 'inactive')
        RETURNING id
      `,
      args: [
        name.trim(),
        email.trim(),
        passwordHash
      ]
    });

    const teacherId =
      teacherResult.rows?.[0]?.id ??
      teacherResult.rows?.[0]?.[0];

    const initialClassName = className?.trim() || "My First Class";
    const joinCode = `CLASS-${teacherId}-${Math.floor(1000 + Math.random() * 9000)}`;

    await db.execute({
      sql: `
        INSERT INTO classes (
          teacher_id,
          class_name,
          year_level,
          join_code
        )
        VALUES (?, ?, ?, ?)
      `,
      args: [
        teacherId,
        initialClassName,
        "",
        joinCode
      ]
    });

    res.cookie(
      "user",
      {
        id: teacherId,
        name: name.trim(),
        role: "teacher",
        class_name: initialClassName,
        plan: "free",
        onboarding: true
      },
      {
        signed: true,
        httpOnly: true,
        sameSite: "strict",
        secure: true
      }
    );

    res.redirect("/teacher/dashboard?welcome=1");
  } catch (err) {
    console.error("POST /signup error:", err);
    res.status(500).send(`Failed to create account: ${err.message}`);
  }
});

/* LOGIN SUBMIT */
router.post("/login", async (req, res) => {
  try {
    const body = req.body || {};
    const { role } = body;

    if (role === "teacher") {
      const { email, password } = body;

      const result = await db.execute({
        sql: `
          SELECT
            id,
            name,
            email,
            password_hash,
            class_name,
            plan
          FROM teachers
          WHERE email = ?
        `,
        args: [email]
      });

      const user = normalizeRow(result.rows?.[0], [
        "id",
        "name",
        "email",
        "password_hash",
        "class_name",
        "plan"
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
          class_name: user.class_name || "",
          plan: user.plan || "free"
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

    const { teacherId, classId, studentId, studentPin } = body;

    const result = await db.execute({
      sql: `
        SELECT
          s.id,
          s.name,
          c.class_name,
          s.student_pin,
          s.pin_needs_reset
        FROM students s
        JOIN classes c ON c.id = s.class_id
        WHERE s.id = ?
          AND s.class_id = ?
          AND c.teacher_id = ?
      `,
      args: [
        studentId,
        classId,
        teacherId
      ]
    });

    const student = normalizeRow(result.rows?.[0], [
      "id",
      "name",
      "class_name",
      "student_pin",
      "pin_needs_reset"
    ]);

    if (!student.id) {
      return res.render("login", {
        error: "Please select a valid student",
        teachers: await getTeachers()
      });
    }

    if (String(student.student_pin || "") !== String(studentPin || "").trim()) {
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

    if (Number(student.pin_needs_reset) === 1) {
      return res.redirect("/student/change-pin");
    }

    return res.redirect("/student/dashboard");
  } catch (err) {
    console.error("POST /login error:", err);
    res.status(500).send("Login failed");
  }
});

/* LOGOUT */
router.get("/logout", (req, res) => {
  res.clearCookie("user");
  res.redirect("/login");
});

export default router;