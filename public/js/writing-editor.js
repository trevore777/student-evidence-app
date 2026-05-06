const appData = window.APP_DATA || {};
const submissionId = appData.submissionId;
const initialContent = appData.initialContent || "";
const serverComposition = appData.serverComposition || null;

let editor = null;
let activePasteId = "";
let activePastedText = "";
let undeclaredPasteIds = new Set();

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function getStudentOnlyText() {
  if (!editor) return "";

  const clone = editor.getBody().cloneNode(true);

  // REMOVE scaffold from calculations
  clone.querySelectorAll("[data-scaffold='true'], .student-scaffold").forEach(el => {
    el.remove();
  });

  return clone.innerText || "";
}

function wordCount(text = "") {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function getCleanEditorClone() {
  if (!editor) return null;

  const clone = editor.getBody().cloneNode(true);

  clone.querySelectorAll("[data-scaffold='true'], .student-scaffold").forEach((el) => {
    el.remove();
  });

  return clone;
}


function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

function getValue(id) {
  return document.getElementById(id)?.value || "";
}

function updateStats() {
  if (!editor) return;

  const body = getCleanEditorClone();
if (!body) return;
  const totalWords = wordCount(body.innerText || "");

  let pastedWords = 0;
  let declaredWords = 0;

  body.querySelectorAll(".pasted-content, [data-pasted='true']").forEach((el) => {
    pastedWords += wordCount(el.innerText || "");
  });

  body.querySelectorAll(".declared-content, [data-declared='true']").forEach((el) => {
    declaredWords += wordCount(el.innerText || "");
  });

  let ownPercent;
  let pastePercent;
  let declaredPercent;

  if (pastedWords === 0 && serverComposition) {
    ownPercent = serverComposition.own_work_percent || 0;
    pastePercent = serverComposition.paste_percent || 0;
    declaredPercent = serverComposition.ai_declared_percent || 0;
  } else {
    const ownWords = Math.max(totalWords - pastedWords, 0);
    ownPercent = totalWords ? Math.round((ownWords / totalWords) * 100) : 0;
    pastePercent = totalWords ? Math.round((pastedWords / totalWords) * 100) : 0;
    declaredPercent = totalWords ? Math.round((declaredWords / totalWords) * 100) : 0;
  }

  setText("word-count", totalWords);
  setText("ownPercent", `${ownPercent}%`);
  setText("pastePercent", `${pastePercent}%`);
  setText("declaredPercent", `${declaredPercent}%`);

  const risk = document.getElementById("riskIndicator");

  if (risk) {
    if (undeclaredPasteIds.size > 0 || pastePercent > 40) {
      risk.textContent = "Risk: High";
      risk.style.background = "#dc2626";
    } else if (pastePercent > 20) {
      risk.textContent = "Risk: Medium";
      risk.style.background = "#f59e0b";
    } else {
      risk.textContent = "Risk: Low";
      risk.style.background = "#16a34a";
    }
  }
}

function openDeclarationModal(text = "", pasteId = "") {
  activePastedText = text;
  activePasteId = pasteId;

  setValue("pastedText", text);
  setValue("declarationExplanation", "");

  const accessedDate = document.getElementById("accessedDate");
  if (accessedDate && !accessedDate.value) {
    accessedDate.value = new Date().toISOString().slice(0, 10);
  }

  const modal = document.getElementById("declarationModal");
  if (modal) modal.style.display = "flex";
}

function closeDeclarationModal() {
  const modal = document.getElementById("declarationModal");
  if (modal) modal.style.display = "none";
}

async function postJSON(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || text || `Request failed: ${response.status}`);
  }

  return data;
}

async function logEditorEvent(eventType, eventMeta = {}) {
  try {
    await postJSON("/api/event", {
      submissionId,
      eventType,
      eventMeta
    });
  } catch (err) {
    console.warn("Event log failed:", err.message);
  }
}

async function save(showAlert = true) {
  if (!editor) return;

  setText("save-status", "Saving...");

  const content = editor.getContent();
  const words = wordCount(editor.getContent({ format: "text" }));

  await postJSON("/api/draft/autosave", {
  submissionId,
  sessionId: window.APP_DATA?.sessionId ?? 0,
  content,
  wordCount: words
});

  setText("save-status", `Saved at ${new Date().toLocaleTimeString()}`);

  if (showAlert) {
    alert("Saved");
  }
}

async function submitWork() {
  if (undeclaredPasteIds.size > 0) {
    alert("You must declare all pasted text before submitting.");
    return;
  }

  const confirmed = confirm("Submit this work?");
  if (!confirmed) return;

  await save(false);

  await postJSON("/api/submit", {
    submissionId,
    finalText: editor.getContent()
  });

  alert("Submitted");
  window.location.href = "/student/dashboard";
}

function addBibliographyEntry(entry) {
  if (!entry || !editor) return;

  let content = editor.getContent();

  if (!content.includes('data-references-section="true"')) {
    content += `
      <div class="references-section" data-references-section="true">
        <h2>References / Bibliography</h2>
        <ul class="references-list"></ul>
      </div>
    `;
  }

  content = content.replace(
    /<ul class="references-list">([\s\S]*?)<\/ul>/,
    `<ul class="references-list">$1<li class="bibliography-entry">${escapeHtml(entry)}</li></ul>`
  );

  editor.setContent(content);
  updateStats();
}

async function saveDeclaration() {
  const explanation = getValue("declarationExplanation").trim();

  if (!explanation) {
    alert("Please explain how you used this material.");
    return;
  }

  const result = await postJSON("/api/declarations", {
  submissionId,
  sessionId: window.APP_DATA?.sessionId ?? 0,
  pasteId: activePasteId,
  pastedText: getValue("pastedText") || activePastedText,
  declarationType: getValue("declarationType"),
  studentExplanation: explanation,
  citationStyle: "apa7",
  sourceType: getValue("sourceType"),
  sourceAuthor: getValue("sourceAuthor"),
  sourceYear: getValue("sourceYear"),
  sourceTitle: getValue("sourceTitle"),
  sourcePublisher: getValue("sourcePublisher"),
  sourceUrl: getValue("sourceUrl"),
  accessedDate: getValue("accessedDate")
});

  if (activePasteId) {
    const span = editor
      .getBody()
      .querySelector(`[data-paste-id="${CSS.escape(activePasteId)}"]`);

    if (span) {
      span.classList.add("declared-content");
      span.setAttribute("data-declared", "true");
      span.setAttribute("title", "Declared material");
    }

    undeclaredPasteIds.delete(activePasteId);
  }

  if (result.inTextCitation) {
    editor.insertContent(
      ` <sup class="citation-marker">${escapeHtml(result.inTextCitation)}</sup>`
    );
  }

  if (result.bibliographyEntry) {
    addBibliographyEntry(result.bibliographyEntry);
  }

  await logEditorEvent("declaration_saved", {
    pasteId: activePasteId,
    declarationType: getValue("declarationType"),
    hasCitation: Boolean(result.inTextCitation),
    hasBibliography: Boolean(result.bibliographyEntry)
  });

  updateStats();

  await save(false);

  closeDeclarationModal();

  activePasteId = "";
  activePastedText = "";

  setText("save-status", "Citation added and reference created ✓");
  alert("Declaration saved. Citation and bibliography added.");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("saveBtn")?.addEventListener("click", () => {
    save(true).catch((err) => alert(err.message || "Save failed"));
  });

  document.getElementById("submitBtn")?.addEventListener("click", () => {
    submitWork().catch((err) => alert(err.message || "Submit failed"));
  });

  document.getElementById("declareBtn")?.addEventListener("click", () => {
    const selected = editor?.selection?.getContent({ format: "text" }) || "";
    openDeclarationModal(selected, "");
  });

  document.getElementById("referenceBtn")?.addEventListener("click", () => {
    const selected = editor?.selection?.getContent({ format: "text" }) || "";
    openDeclarationModal(selected, "");
  });

  document.getElementById("cancelDeclarationBtn")?.addEventListener("click", closeDeclarationModal);

  document.getElementById("saveDeclarationBtn")?.addEventListener("click", () => {
    saveDeclaration().catch((err) => alert(err.message || "Declaration save failed"));
  });

  document.getElementById("toggleEvidenceView")?.addEventListener("click", () => {
    const panel = document.getElementById("studentEvidencePanel");
    const btn = document.getElementById("toggleEvidenceView");
    if (!panel || !btn) return;
    const hidden = panel.classList.toggle("student-hidden");
    btn.textContent = hidden ? "Show evidence guide" : "Hide evidence guide";
  });

  document.getElementById("toggleCompositionView")?.addEventListener("click", () => {
    const panel = document.getElementById("studentCompositionPanel");
    const btn = document.getElementById("toggleCompositionView");
    if (!panel || !btn) return;
    const hidden = panel.classList.toggle("student-hidden");
    btn.textContent = hidden ? "Show composition" : "Hide composition";
  });

  tinymce.init({
    selector: "#editor",
    height: 680,
    menubar: "file edit insert view format table tools",
    branding: false,
    browser_spellcheck: true,
    contextmenu: false,
    plugins: "lists advlist link image media table code wordcount autoresize charmap preview searchreplace visualblocks fullscreen",
    toolbar: [
      "undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | forecolor backcolor",
      "alignleft aligncenter alignright alignjustify | bullist numlist | outdent indent",
      "link image media table | removeformat | preview fullscreen code"
    ],
    toolbar_mode: "sliding",
    paste_as_text: false,

    content_style: `
      body {
        font-family: Arial, sans-serif;
        font-size: 16px;
        line-height: 1.6;
        padding: 12px;
      }

      /* Student editor: keep evidence classes/data attributes for teacher review, but hide visual colours from students. */
      .pasted-content,
      .declared-content,
      .ai-content,
      .ai-generated-content,
      .ai-modified-content,
      .citation-marker,
      span[data-pasted="true"],
      span[data-declared="true"],
      span[data-normal-text="true"] {
        background: transparent !important;
        border: none !important;
        padding: 0 !important;
        border-radius: 0 !important;
        font-weight: inherit !important;
      }

      .event-marker {
        display: none !important;
      }

      .references-section {
        margin-top: 2rem;
        border-top: 2px solid #16a34a;
        padding-top: 0.75rem;
      }

      .references-list {
        padding-left: 1.5rem;
      }

      .bibliography-entry {
        background: #f0fdf4;
        border-left: 4px solid #16a34a;
        padding: 0.35rem 0.5rem;
        margin: 0.35rem 0;
      }

      span[data-normal-text="true"] {
        background: transparent !important;
        border-bottom: none !important;
      }

      img {
        max-width: 100%;
        height: auto;
      }

      table {
        border-collapse: collapse;
        width: 100%;
      }

      td,
      th {
        border: 1px solid #cbd5e1;
        padding: 8px;
      }
    `,

    setup: (ed) => {
      editor = ed;

      ed.on("init", () => {
        const scaffold = window.APP_DATA?.studentScaffold || "";

if (initialContent && initialContent.trim()) {
  editor.setContent(initialContent);
} else if (scaffold && scaffold.trim()) {
  editor.setContent(`
    <div class="student-scaffold" data-scaffold="true" contenteditable="false">
      ${scaffold}
    </div>
    <p><br></p>
  `);
} else {
  editor.setContent("");
}

        editor.getBody().querySelectorAll(".pasted-content[data-paste-id]").forEach((el) => {
          if (el.getAttribute("data-declared") !== "true") {
            undeclaredPasteIds.add(el.getAttribute("data-paste-id"));
          }
        });

        setText("save-status", "Ready");
        updateStats();
      });

      ed.on("input keyup change undo redo setcontent", updateStats);

      ed.on("paste", (event) => {
  event.preventDefault();

  const text =
    event.clipboardData?.getData("text/plain") ||
    event.originalEvent?.clipboardData?.getData("text/plain") ||
    "";

  if (!text.trim()) return;

  const pasteId = `paste-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const eventRef = `E${Date.now().toString().slice(-4)}`;

  undeclaredPasteIds.add(pasteId);

  const pastedHtml = `
    <span
      class="pasted-content"
      data-pasted="true"
      data-paste-id="${pasteId}"
      data-event-ref="${eventRef}"
    >${escapeHtml(text)} <sup class="event-marker">${eventRef}</sup></span>
    <span data-normal-text="true">&nbsp;</span>
  `;

  editor.insertContent(pastedHtml);

  logEditorEvent("paste", {
    pasteId,
    eventRef,
    pastedLength: text.length,
    pastedPreview: text.slice(0, 300)
  });

  openDeclarationModal(text, pasteId);
  updateStats();

  save(false).catch(console.error);
});

      ed.on("cut", () => {
        const selected = editor.selection.getContent({ format: "text" }) || "";

        logEditorEvent("cut", {
          selectedLength: selected.length,
          selectedPreview: selected.slice(0, 150)
        });
      });

      ed.on("copy", () => {
        const selected = editor.selection.getContent({ format: "text" }) || "";

        logEditorEvent("copy", {
          selectedLength: selected.length,
          selectedPreview: selected.slice(0, 150)
        });
      });
    }
  });
});