import express from "express";

const router = express.Router();

function requireStudent(req, res, next) {
  const user = req.signedCookies?.user;
  if (!user || user.role !== "student") {
    return res.redirect("/login");
  }
  next();
}

// Temporary hardcoded assignments by class
const assignmentsByClass = {
  "Year 10A": [
    {
      id: 1,
      title: "AI and Academic Integrity Reflection",
      instructions: "Write a reflection explaining how you used AI appropriately in this task.",
      due_date: "2026-05-01"
    }
  ],
  "Year 10B": [
    {
      id: 2,
      title: "Evaluating Sources",
      instructions: "Compare two sources and explain which is more reliable.",
      due_date: "2026-05-08"
    }
  ]
};

router.get("/dashboard", requireStudent, async (req, res) => {
  try {
    const student = req.signedCookies.user;
    const assignments = assignmentsByClass[student.class_name] || [];

    res.render("student-dashboard", {
      student,
      assignments
    });
  } catch (err) {
    console.error("GET /student/dashboard error:", err);
    res.status(500).send("Failed to load student dashboard");
  }
});

router.get("/assignment/:id", requireStudent, async (req, res) => {
  try {
    const student = req.signedCookies.user;
    const assignmentId = Number(req.params.id);
    const assignments = assignmentsByClass[student.class_name] || [];
    const assignment = assignments.find((a) => a.id === assignmentId);

    if (!assignment) {
      return res.status(404).send("Assignment not found");
    }

    // Temporary fake submission payload
    const submission = {
      id: assignment.id,
      assignment_id: assignment.id,
      student_id: student.id,
      final_text: "",
      status: "draft"
    };

    res.render("writing", {
      student,
      assignment,
      submission,
      latestContent: ""
    });
  } catch (err) {
    console.error("GET /student/assignment/:id error:", err);
    res.status(500).send("Failed to load assignment");
  }
});

export default router;