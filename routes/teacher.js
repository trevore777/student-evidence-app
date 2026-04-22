import express from "express";
import requireTeacher from "../middleware/requireTeacher.js";
import { computeFlags, estimateComposition } from "../lib/flags.js";

const router = express.Router();

// Temporary hardcoded teacher-side data
const demoAssignmentsByClass = {
  "Year 10A": [
    {
      id: 1,
      teacher_id: 1,
      title: "AI and Academic Integrity Reflection",
      instructions: "Write a reflection explaining how you used AI appropriately in this task.",
      class_name: "Year 10A",
      due_date: "2026-05-01"
    }
  ],
  "Year 10B": [
    {
      id: 2,
      teacher_id: 2,
      title: "Evaluating Sources",
      instructions: "Compare two sources and explain which is more reliable.",
      class_name: "Year 10B",
      due_date: "2026-05-08"
    }
  ]
};

const demoSubmissionsByClass = {
  "Year 10A": [
    {
      id: 1,
      status: "submitted",
      submitted_at: "2026-04-21 10:15:00",
      final_text: "<p>I used AI to help me check my grammar and improve my wording. I wrote the main ideas myself and then edited the suggestions before submitting.</p>",
      student_name: "Demo Student",
      class_name: "Year 10A",
      assignment_title: "AI and Academic Integrity Reflection",
      assignment_id: 1
    },
    {
      id: 2,
      status: "draft",
      submitted_at: null,
      final_text: "<p>I copied some research notes and then rewrote them in my own words.</p>",
      student_name: "Ella Brown",
      class_name: "Year 10A",
      assignment_title: "AI and Academic Integrity Reflection",
      assignment_id: 1
    }
  ],
  "Year 10B": [
    {
      id: 3,
      status: "submitted",
      submitted_at: "2026-04-21 09:05:00",
      final_text: "<p>Source A is more reliable because it is current and written by an expert author.</p>",
      student_name: "Noah Smith",
      class_name: "Year 10B",
      assignment_title: "Evaluating Sources",
      assignment_id: 2
    },
    {
      id: 4,
      status: "draft",
      submitted_at: null,
      final_text: "<p>I am still comparing the two websites before deciding which source is stronger.</p>",
      student_name: "Ruby Jones",
      class_name: "Year 10B",
      assignment_title: "Evaluating Sources",
      assignment_id: 2
    }
  ]
};

const demoEventsBySubmission = {
  1: [
    {
      event_type: "paste",
      event_meta: JSON.stringify({ pastedLength: 120, pastedPreview: "AI improved sentence..." }),
      created_at: "2026-04-21 10:05:00"
    },
    {
      event_type: "autosave",
      event_meta: JSON.stringify({ wordCount: 85 }),
      created_at: "2026-04-21 10:10:00"
    }
  ],
  2: [
    {
      event_type: "paste",
      event_meta: JSON.stringify({ pastedLength: 220, pastedPreview: "research notes..." }),
      created_at: "2026-04-21 09:55:00"
    }
  ],
  3: [],
  4: []
};

const demoDeclarationsBySubmission = {
  1: [
    {
      declaration_type: "ai_modified",
      tool_name: "ChatGPT",
      prompt_text: "Improve grammar and clarity",
      original_text_excerpt: "I used AI to improve grammar",
      student_explanation: "I wrote the ideas and used AI to improve my wording.",
      created_at: "2026-04-21 10:06:00"
    }
  ],
  2: [
    {
      declaration_type: "pasted_research",
      tool_name: "",
      prompt_text: "",
      original_text_excerpt: "Copied research notes",
      student_explanation: "I used notes and planned to rewrite them.",
      created_at: "2026-04-21 09:56:00"
    }
  ],
  3: [],
  4: []
};

const demoSessionsBySubmission = {
  1: [
    {
      started_at: "2026-04-21 10:00:00",
      ended_at: "2026-04-21 10:15:00",
      active_seconds: 600,
      idle_seconds: 60
    }
  ],
  2: [
    {
      started_at: "2026-04-21 09:50:00",
      ended_at: "2026-04-21 10:00:00",
      active_seconds: 240,
      idle_seconds: 120
    }
  ],
  3: [
    {
      started_at: "2026-04-21 08:55:00",
      ended_at: "2026-04-21 09:05:00",
      active_seconds: 420,
      idle_seconds: 20
    }
  ],
  4: []
};

const demoSnapshotsBySubmission = {
  1: [
    {
      id: 1,
      content: "<p>I used AI to check my grammar.</p>",
      word_count: 9,
      saved_at: "2026-04-21 10:05:00"
    },
    {
      id: 2,
      content: "<p>I used AI to help me check my grammar and improve my wording. I wrote the main ideas myself and then edited the suggestions before submitting.</p>",
      word_count: 24,
      saved_at: "2026-04-21 10:12:00"
    }
  ],
  2: [],
  3: [],
  4: []
};

router.get("/dashboard", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const selectedClass = teacher.class_name || req.query.class || "Year 10A";
    const flaggedOnly = req.query.flagged === "1";

    const assignments = demoAssignmentsByClass[selectedClass] || [];
    const submissions = demoSubmissionsByClass[selectedClass] || [];

    const enriched = submissions.map((row) => {
      const events = demoEventsBySubmission[row.id] || [];
      const declarations = demoDeclarationsBySubmission[row.id] || [];
      const sessions = demoSessionsBySubmission[row.id] || [];

      const flags = computeFlags({
        events,
        declarations,
        sessions,
        finalText: row.final_text || ""
      });

      return { ...row, flags };
    });

    const rows = flaggedOnly
      ? enriched.filter((r) => r.flags.length > 0)
      : enriched;

    res.render("teacher-dashboard", {
      teacher,
      assignments,
      submissions: rows,
      classes: [selectedClass],
      selectedClass,
      flaggedOnly
    });
  } catch (err) {
    console.error("GET /teacher/dashboard error:", err);
    res.status(500).send("Failed to load teacher dashboard");
  }
});

router.get("/submission/:id", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const submissionId = Number(req.params.id);
    const selectedClass = teacher.class_name || "Year 10A";

    const submissions = demoSubmissionsByClass[selectedClass] || [];
    const submission = submissions.find((s) => s.id === submissionId);

    if (!submission) {
      return res.status(404).send("Submission not found");
    }

    const sessions = demoSessionsBySubmission[submissionId] || [];
    const events = demoEventsBySubmission[submissionId] || [];
    const declarations = demoDeclarationsBySubmission[submissionId] || [];
    const snapshots = demoSnapshotsBySubmission[submissionId] || [];

    const composition = estimateComposition({
      events,
      declarations,
      sessions,
      finalText: submission.final_text || ""
    });

    const flags = computeFlags({
      events,
      declarations,
      sessions,
      finalText: submission.final_text || ""
    });

    res.render("teacher-review", {
      submission: {
        ...submission,
        student_email:
          submission.student_name === "Demo Student"
            ? "student@test.com"
            : submission.student_name === "Ella Brown"
            ? "ella@test.com"
            : submission.student_name === "Noah Smith"
            ? "noah@test.com"
            : "ruby@test.com",
        instructions:
          selectedClass === "Year 10A"
            ? "Write a reflection explaining how you used AI appropriately in this task."
            : "Compare two sources and explain which is more reliable."
      },
      sessions,
      events,
      declarations,
      snapshots,
      flags,
      composition
    });
  } catch (err) {
    console.error("GET /teacher/submission/:id error:", err);
    res.status(500).send("Failed to load teacher review");
  }
});

export default router;