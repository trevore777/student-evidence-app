import express from "express";
import puppeteer from "puppeteer";
import AdmZip from "adm-zip";
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
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function safeHtml(value) {
  return String(value || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripHtml(html = "") {
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text = "") {
  const clean = String(text || "").trim();
  return clean ? clean.split(/\s+/).filter(Boolean).length : 0;
}

function scaffoldAwareWordCount(html = "", scaffoldHtml = "") {
  const contentWords = countWords(stripHtml(html || ""));
  const scaffoldWords = countWords(stripHtml(scaffoldHtml || ""));
  return Math.max(0, contentWords - scaffoldWords);
}

function safeFilename(value) {
  return String(value || "file")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    timeout: 60000
  });
}

async function renderPdfFromHtml(html, browser = null) {
  const shouldClose = !browser;
  const activeBrowser = browser || (await launchBrowser());

  try {
    const page = await activeBrowser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    await page.emulateMediaType("screen");

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" }
    });

    await page.close();
    return Buffer.from(pdf);
  } finally {
    if (shouldClose) await activeBrowser.close();
  }
}

function sendPdf(res, pdf, filename) {
  const pdfBuffer = Buffer.from(pdf);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", pdfBuffer.length);
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.end(pdfBuffer);
}

function pdfStyles() {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      color: #111827;
      line-height: 1.45;
      font-size: 13px;
      margin: 0;
    }
    h1 {
      font-size: 34px;
      margin: 0 0 8px;
      padding-bottom: 10px;
      border-bottom: 1px solid #6b7280;
    }
    h2 {
      font-size: 18px;
      margin: 20px 0 10px;
    }
    .meta {
      margin: 12px 0 16px;
      font-size: 15px;
      color: #111827;
    }
    .grades-box {
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      overflow: hidden;
      margin-bottom: 18px;
    }
    .grade-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #cbd5e1;
      min-height: 48px;
      padding: 0 28px 0 18px;
      font-size: 15px;
      font-weight: 700;
    }
    .grade-row:last-child { border-bottom: none; }
    .grade-name {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .grade-name .arrow {
      font-size: 15px;
      color: #111827;
      line-height: 1;
    }
    .grade-score {
      font-size: 16px;
      font-weight: 800;
      white-space: nowrap;
    }
    .grade-total {
      background: #eaf2ff;
      font-size: 20px;
      min-height: 54px;
    }
    .writing-box {
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      padding: 14px 16px;
      min-height: 120px;
      margin-bottom: 22px;
      overflow-wrap: break-word;
    }
    .writing-box p { margin-top: 0; }
    .references-list {
      margin: 0;
      padding-left: 28px;
    }
    .references-list li {
      margin-bottom: 8px;
      overflow-wrap: break-word;
    }
    .small { color: #6b7280; font-size: 12px; }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #ddd; padding: 6px; }
    .page-break { page-break-after: always; break-after: page; }
    pre { white-space: pre-wrap; font-family: Arial, sans-serif; }
  `;
}

async function getSubmissionForTeacher(submissionId, teacherId) {
  const submissionResult = await db.execute({
    sql: `
      SELECT
        sub.id,
        sub.assignment_id,
        sub.student_id,
        sub.final_text,
        sub.status,
        sub.submitted_at,
        s.name AS student_name,
        s.email AS student_email,
        c.class_name,
        a.title AS assignment_title,
        a.instructions,
        a.rubric_text,
        a.student_scaffold
      FROM submissions sub
      JOIN students s ON s.id = sub.student_id
      JOIN classes c ON c.id = s.class_id
      JOIN assignments a ON a.id = sub.assignment_id
      WHERE sub.id = ? AND a.teacher_id = ?
    `,
    args: [submissionId, teacherId]
  });

  const submission = normalizeRow(submissionResult.rows?.[0], [
    "id", "assignment_id", "student_id", "final_text", "status", "submitted_at",
    "student_name", "student_email", "class_name", "assignment_title", "instructions",
    "rubric_text", "student_scaffold"
  ]);

  if (!submission.id) return null;

  const declarationsResult = await db.execute({
    sql: `
      SELECT declaration_type, tool_name, student_explanation, in_text_citation,
             bibliography_entry, source_author, source_year, source_title, source_url, created_at
      FROM source_declarations
      WHERE submission_id = ?
      ORDER BY created_at ASC
    `,
    args: [submissionId]
  });

  const eventsResult = await db.execute({
    sql: `
      SELECT event_type, event_meta, created_at
      FROM editor_events
      WHERE submission_id = ?
      ORDER BY created_at ASC
    `,
    args: [submissionId]
  });

  const declarations = (declarationsResult.rows || []).map((row) =>
    normalizeRow(row, [
      "declaration_type", "tool_name", "student_explanation", "in_text_citation",
      "bibliography_entry", "source_author", "source_year", "source_title", "source_url", "created_at"
    ])
  );

  const events = (eventsResult.rows || []).map((row) =>
    normalizeRow(row, ["event_type", "event_meta", "created_at"])
  );

  let reportComment = null;
  try {
    const commentResult = await db.execute({
      sql: `
        SELECT comment_text, updated_at, rubric_json
        FROM report_comments
        WHERE submission_id = ? AND teacher_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      args: [submissionId, teacherId]
    });

    reportComment = normalizeRow(commentResult.rows?.[0], ["comment_text", "updated_at", "rubric_json"]);
  } catch {
    reportComment = null;
  }

  return {
    ...submission,
    declarations,
    events,
    reportComment,
    wordCount: scaffoldAwareWordCount(submission.final_text || "", submission.student_scaffold || "")
  };
}

function getSavedRubricData(submission) {
  const raw = submission.reportComment?.rubric_json;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildCriteriaScoresHtml(submission) {
  const data = getSavedRubricData(submission);
  const criteria = Array.isArray(data?.criteria) ? data.criteria : [];

  if (!criteria.length) {
    return `
      <h2>Grades</h2>
      <div class="grades-box">
        <div class="grade-row">
          <span>No saved criteria scores found.</span>
        </div>
      </div>
      <p class="small">Generate the AI rubric review on the Teacher Review page, then click “Save report comment / scores for PDF export”.</p>
    `;
  }

  const rows = criteria.map((item, index) => {
    const name = item.name || `Criterion ${index + 1}`;
    const mark = Number.isFinite(Number(item.mark)) ? Number(item.mark) : 0;
    const possible = Number.isFinite(Number(item.possible)) ? Number(item.possible) : 0;

    return `
      <div class="grade-row">
        <div class="grade-name"><span class="arrow">▶</span><span>${escapeHtml(name)}</span></div>
        <div class="grade-score">${escapeHtml(mark)} / ${escapeHtml(possible)}</div>
      </div>
    `;
  }).join("");

  const calculatedTotal = criteria.reduce((sum, item) => sum + (Number(item.mark) || 0), 0);
  const calculatedPossible = criteria.reduce((sum, item) => sum + (Number(item.possible) || 0), 0);
  const totalMark = Number.isFinite(Number(data?.totalMark)) ? Number(data.totalMark) : calculatedTotal;
  const totalPossible = Number.isFinite(Number(data?.totalPossible)) ? Number(data.totalPossible) : (calculatedPossible || 25);

  return `
    <h2>Grades</h2>
    <div class="grades-box">
      ${rows}
      <div class="grade-row grade-total">
        <div>Total</div>
        <div class="grade-score">${escapeHtml(totalMark)} / ${escapeHtml(totalPossible)}</div>
      </div>
    </div>
  `;
}

function buildReferencesHtml(submission) {
  const references = [];

  (submission.declarations || []).forEach((d) => {
    if (d.bibliography_entry) {
      references.push(d.bibliography_entry);
      return;
    }

    const fallbackParts = [];
    if (d.source_author) fallbackParts.push(d.source_author);
    if (d.source_year) fallbackParts.push(`(${d.source_year})`);
    if (d.source_title) fallbackParts.push(d.source_title);
    if (d.source_url) fallbackParts.push(d.source_url);

    const fallback = fallbackParts.join(". ").replace(/\. \(/, " (");
    if (fallback.trim()) references.push(fallback);
  });

  const uniqueReferences = [...new Set(references.map((ref) => String(ref || "").trim()).filter(Boolean))];

  if (!uniqueReferences.length) {
    return `<p class="small">No references recorded.</p>`;
  }

  return `
    <ol class="references-list">
      ${uniqueReferences.map((ref) => `<li>${escapeHtml(ref)}</li>`).join("")}
    </ol>
  `;
}

function buildEvidencePdfHtml(submission) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <style>${pdfStyles()}</style>
    </head>
    <body>
      <h1>${escapeHtml(submission.student_name)}</h1>
      <p class="meta">Word count: <strong>${submission.wordCount || 0}</strong></p>

      ${buildCriteriaScoresHtml(submission)}

      <h2>Student Writing Evidence</h2>
      <div class="writing-box">${safeHtml(submission.final_text || "<p>No writing submitted.</p>")}</div>


<h2>References</h2>
${buildReferencesHtml(submission)}

${
  getSavedRubricData(submission)?.studentSummary
    ? `
      <h2>Student Summary</h2>
      <div class="writing-box">
        ${escapeHtml(getSavedRubricData(submission).studentSummary)}
      </div>
    `
    : ""
}

    </body>
    </html>
  `;
}

function buildCommentsPdfHtml(classRow, submissions) {
  const rows = submissions.map((s) => `
    <section class="box">
      <h2>${escapeHtml(s.student_name)} — ${escapeHtml(s.assignment_title)}</h2>
      ${s.reportComment?.comment_text
        ? `<pre>${escapeHtml(s.reportComment.comment_text)}</pre><p class="small">Saved: ${formatDateTime(s.reportComment.updated_at)}</p>`
        : `<p class="small">No saved report comment found.</p>`
      }
    </section>
  `).join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <style>${pdfStyles()}</style>
    </head>
    <body>
      <h1>AI Report Comments — ${escapeHtml(classRow.class_name)}</h1>
      <p class="small">Generated from saved report comments in Student Evidence App.</p>
      ${rows || "<p>No submissions selected.</p>"}
    </body>
    </html>
  `;
}

async function getClassForTeacher(classId, teacherId) {
  const classResult = await db.execute({
    sql: `SELECT id, class_name FROM classes WHERE id = ? AND teacher_id = ?`,
    args: [classId, teacherId]
  });

  return normalizeRow(classResult.rows?.[0], ["id", "class_name"]);
}

router.post("/submission/:id/report-comment", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const submissionId = Number(req.params.id);
    const commentText = String(req.body.commentText || "").trim();
    const rubricJson = req.body.rubricJson ? JSON.stringify(req.body.rubricJson) : null;

    if (!Number.isFinite(submissionId)) {
      return res.status(400).json({ error: "Invalid submission ID" });
    }

    const submission = await getSubmissionForTeacher(submissionId, teacher.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    await db.execute({
      sql: `
        CREATE TABLE IF NOT EXISTS report_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submission_id INTEGER NOT NULL,
          teacher_id INTEGER NOT NULL,
          student_id INTEGER,
          assignment_id INTEGER,
          comment_text TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          rubric_json TEXT,
          UNIQUE(submission_id, teacher_id)
        )
      `
    });

    try {
      await db.execute({ sql: `ALTER TABLE report_comments ADD COLUMN rubric_json TEXT` });
    } catch {
      // Column already exists or database does not allow duplicate ALTER; safe to ignore.
    }

    await db.execute({
      sql: `
        INSERT INTO report_comments (
          submission_id, teacher_id, student_id, assignment_id, comment_text, rubric_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(submission_id, teacher_id)
        DO UPDATE SET
          comment_text = excluded.comment_text,
          rubric_json = excluded.rubric_json,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [submissionId, teacher.id, submission.student_id, submission.assignment_id, commentText, rubricJson]
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /teacher/print/submission/:id/report-comment error:", err);
    return res.status(500).json({ error: err.message || "Failed to save report comment" });
  }
});

router.get("/submission/:id/pdf", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const submissionId = Number(req.params.id);
    const includeReportComment = req.query.includeReportComment === "1";

    const submission = await getSubmissionForTeacher(submissionId, teacher.id);
    if (!submission) return res.status(404).send("Submission not found");

    const html = buildEvidencePdfHtml(submission);
    const pdf = await renderPdfFromHtml(html);
    return sendPdf(res, pdf, `${safeFilename(submission.student_name)}_${safeFilename(submission.assignment_title)}_QCAA_Evidence.pdf`);
  } catch (err) {
    console.error("GET /teacher/print/submission/:id/pdf error:", err);
    res.status(500).send(`Failed to generate submission PDF: ${err.message || "Unknown error"}`);
  }
});

router.post("/class/:classId/batch-pdfs", requireTeacher, async (req, res) => {
  const browser = await launchBrowser();

  try {
    const teacher = req.signedCookies.user;
    const classId = Number(req.params.classId);
    const includeEvidencePdfs = req.body.includeEvidencePdfs === "1" || req.body.includeEvidencePdfs === "on";
    
    let submissionIds = req.body.submissionIds || [];
    if (!Array.isArray(submissionIds)) submissionIds = [submissionIds];

    submissionIds = submissionIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));

    if (!Number.isFinite(classId)) return res.status(400).send("Invalid class ID");
    if (!submissionIds.length) return res.status(400).send("Select at least one student with submitted work.");

    const classRow = await getClassForTeacher(classId, teacher.id);
    if (!classRow.id) return res.status(404).send("Class not found");

    const zip = new AdmZip();
    const submissions = [];

    for (const submissionId of submissionIds) {
      const submission = await getSubmissionForTeacher(submissionId, teacher.id);
      if (!submission) continue;
      submissions.push(submission);

      if (includeEvidencePdfs) {
        const html = buildEvidencePdfHtml(submission);
        const pdf = await renderPdfFromHtml(html, browser);
        const filename = `${safeFilename(submission.student_name)}_${safeFilename(submission.assignment_title)}_QCAA_Evidence.pdf`;
        zip.addFile(filename, pdf);
      }
    }


    const zipBuffer = zip.toBuffer();
    const zipName = `${safeFilename(classRow.class_name)}_QCAA_PDF_Export.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", zipBuffer.length);
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
    return res.end(zipBuffer);
  } catch (err) {
    console.error("POST /teacher/print/class/:classId/batch-pdfs error:", err);
    return res.status(500).send(`Failed to generate batch PDFs: ${err.message || "Unknown error"}`);
  } finally {
    await browser.close();
  }
});

router.get("/class/:classId/pdf", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const classId = Number(req.params.classId);
    const classRow = await getClassForTeacher(classId, teacher.id);

    if (!classRow.id) return res.status(404).send("Class not found");

    const submissionsResult = await db.execute({
      sql: `
        SELECT sub.id
        FROM submissions sub
        JOIN assignments a ON a.id = sub.assignment_id
        JOIN students s ON s.id = sub.student_id
        WHERE a.class_id = ? AND a.teacher_id = ?
        ORDER BY s.name ASC, a.title ASC
      `,
      args: [classId, teacher.id]
    });

    const ids = (submissionsResult.rows || []).map((row) => normalizeRow(row, ["id"]).id);
    const sections = [];

    for (const id of ids) {
      const submission = await getSubmissionForTeacher(id, teacher.id);
      if (!submission) continue;
      sections.push(`<section class="page-break">${buildEvidencePdfHtml(submission, false).match(/<body>([\s\S]*)<\/body>/)?.[1] || ""}</section>`);
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${pdfStyles()}</style></head><body><h1>Class Set: ${escapeHtml(classRow.class_name)}</h1>${sections.join("") || "<p>No submissions found.</p>"}</body></html>`;
    const pdf = await renderPdfFromHtml(html);
    return sendPdf(res, pdf, `class-${safeFilename(classRow.class_name)}.pdf`);
  } catch (err) {
    console.error("GET /teacher/print/class/:classId/pdf error:", err);
    res.status(500).send(`Failed to generate class PDF: ${err.message || "Unknown error"}`);
  }
});

export default router;
