import express from "express";
import puppeteer from "puppeteer";
import { db } from "../lib/db.js";
import requireTeacher from "../middleware/requireTeacher.js";

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

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

async function renderPdfFromHtml(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    timeout: 60000
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });

    // Load the HTML without waiting for full network idle
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Give images and layout a short moment to settle
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await page.emulateMediaType("screen");

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "16mm",
        right: "12mm",
        bottom: "16mm",
        left: "12mm"
      }
    });
  } finally {
    await browser.close();
  }
}

router.get("/submission/:id/pdf", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const submissionId = Number(req.params.id);

    const submissionResult = await db.execute({
      sql: `
        SELECT
          sub.id,
          sub.final_text,
          sub.status,
          sub.submitted_at,
          s.name AS student_name,
          s.email AS student_email,
          c.class_name,
          a.title AS assignment_title,
          a.instructions
        FROM submissions sub
        JOIN students s ON s.id = sub.student_id
        JOIN classes c ON c.id = s.class_id
        JOIN assignments a ON a.id = sub.assignment_id
        WHERE sub.id = ? AND a.teacher_id = ?
      `,
      args: [submissionId, teacher.id]
    });

    const submission = normalizeRow(submissionResult.rows?.[0], [
      "id",
      "final_text",
      "status",
      "submitted_at",
      "student_name",
      "student_email",
      "class_name",
      "assignment_title",
      "instructions"
    ]);

    if (!submission.id) {
      return res.status(404).send("Submission not found");
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #222; }
          h1, h2, h3 { margin-bottom: 6px; }
          .meta { margin-bottom: 16px; font-size: 14px; color: #555; }
          .box {
            border: 1px solid #ddd;
            border-radius: 10px;
            padding: 14px;
            margin-bottom: 16px;
          }
          .final-text {
            border: 1px solid #ddd;
            border-radius: 10px;
            padding: 16px;
          }
          .pasted-content {
            background: #fff3b0;
            border-bottom: 2px solid #f59e0b;
            padding: 0 2px;
          }
          img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
          }
        </style>
      </head>
      <body>
        <h1>${submission.assignment_title}</h1>
        <div class="meta">
          <strong>Student:</strong> ${submission.student_name}<br />
          <strong>Email:</strong> ${submission.student_email || "—"}<br />
          <strong>Class:</strong> ${submission.class_name}<br />
          <strong>Status:</strong> ${submission.status}<br />
          <strong>Submitted:</strong> ${formatDate(submission.submitted_at)}
        </div>

        <div class="box">
          <h3>Instructions</h3>
          <div>${String(submission.instructions || "")}</div>
          <div class="final-text">${String(submission.final_text || "")}</div>
        </div>

        <div class="box">
          <h3>Submission</h3>
          <div class="final-text">${submission.final_text || ""}</div>
        </div>
      </body>
      </html>
    `;

    const pdf = await renderPdfFromHtml(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="submission-${submissionId}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    console.error("GET /teacher/print/submission/:id/pdf error:", err);
    res.status(500).send("Failed to generate submission PDF");
  }
});

router.get("/class/:classId/pdf", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const classId = Number(req.params.classId);

    const classResult = await db.execute({
      sql: `
        SELECT id, class_name
        FROM classes
        WHERE id = ? AND teacher_id = ?
      `,
      args: [classId, teacher.id]
    });

    const classRow = normalizeRow(classResult.rows?.[0], ["id", "class_name"]);

    if (!classRow.id) {
      return res.status(404).send("Class not found");
    }

    const submissionsResult = await db.execute({
      sql: `
        SELECT
          sub.id,
          sub.final_text,
          sub.status,
          sub.submitted_at,
          s.name AS student_name,
          s.email AS student_email,
          a.title AS assignment_title
        FROM submissions sub
        JOIN students s ON s.id = sub.student_id
        JOIN assignments a ON a.id = sub.assignment_id
        WHERE a.class_id = ? AND a.teacher_id = ?
        ORDER BY s.name ASC, a.title ASC
      `,
      args: [classId, teacher.id]
    });

    const submissions = (submissionsResult.rows || []).map((row) =>
      normalizeRow(row, [
        "id",
        "final_text",
        "status",
        "submitted_at",
        "student_name",
        "student_email",
        "assignment_title"
      ])
    );

    const pages = submissions.map((s) => `
      <section class="submission-page">
        <h2>${s.student_name} — ${s.assignment_title}</h2>
        <div class="meta">
          <strong>Email:</strong> ${s.student_email || "—"}<br />
          <strong>Status:</strong> ${s.status}<br />
          <strong>Submitted:</strong> ${formatDate(s.submitted_at)}
        </div>
        <div class="final-text">${String(s.final_text || "")}</div>
      </section>
    `).join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #222; }
          h1, h2 { margin-bottom: 6px; }
          .meta { margin-bottom: 16px; font-size: 14px; color: #555; }
          .submission-page {
            page-break-after: always;
            break-after: page;
            margin-bottom: 24px;
          }
          .submission-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .final-text {
            border: 1px solid #ddd;
            border-radius: 10px;
            padding: 16px;
          }
          .pasted-content {
            background: #fff3b0;
            border-bottom: 2px solid #f59e0b;
            padding: 0 2px;
          }
          img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
          }
        </style>
      </head>
      <body>
        <h1>Class Set: ${classRow.class_name}</h1>
        ${pages || "<p>No submissions found.</p>"}
      </body>
      </html>
    `;

    const pdf = await renderPdfFromHtml(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="class-${classRow.class_name}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    console.error("GET /teacher/print/class/:classId/pdf error:", err);
    res.status(500).send("Failed to generate class PDF");
  }
});

export default router;