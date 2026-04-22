import express from "express";

const router = express.Router();

const fallbackClasses = [
  { class_name: "Year 10A" },
  { class_name: "Year 10B" }
];

const demoStudents = {
  "1": { id: 1, name: "Demo Student", class_name: "Year 10A" },
  "2": { id: 2, name: "Ella Brown", class_name: "Year 10A" },
  "3": { id: 3, name: "Noah Smith", class_name: "Year 10B" },
  "4": { id: 4, name: "Ruby Jones", class_name: "Year 10B" }
};

const demoTeachers = {
  "teacher@test.com": {
    id: 1,
    name: "Demo Teacher",
    email: "teacher@test.com",
    password: "teacher123",
    class_name: "Year 10A"
  },
  "baker@test.com": {
    id: 2,
    name: "Ms Baker",
    email: "baker@test.com",
    password: "teacher123",
    class_name: "Year 10B"
  }
};

router.get("/login", async (req, res) => {
  try {
    res.render("login", { error: null, classes: fallbackClasses });
  } catch (err) {
    console.error("GET /login error:", err);
    res.status(500).send("Failed to load login page");
  }
});

router.post("/login", async (req, res) => {
  try {
    const { role } = req.body;

    if (role === "teacher") {
      const { email, password } = req.body;
      const user = demoTeachers[String(email).toLowerCase()];

      if (!user || user.password !== password) {
        return res.render("login", {
          error: "Invalid login details",
          classes: fallbackClasses
        });
      }

      res.cookie(
        "user",
        {
          id: user.id,
          name: user.name,
          role: "teacher",
          class_name: user.class_name
        },
        {
          signed: true,
          httpOnly: true,
          sameSite: "lax"
        }
      );

      return res.redirect("/teacher/dashboard");
    }

    const { studentId } = req.body;
    const student = demoStudents[String(studentId)];

    if (!student) {
      return res.render("login", {
        error: "Please select a valid student",
        classes: fallbackClasses
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
        sameSite: "lax"
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