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

function wordCount(text = "") {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
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

  const body = editor.getBody();
  const totalWords = wordCount(body.innerText || "");

  let pastedWords = 0;
  let declaredWords = 0;

  body.querySelectorAll(".pasted-content, [data-pasted='true']").forEach(el => {
    pastedWords += wordCount(el.innerText || "");
  });

  body.querySelectorAll(".declared-content, [data-declared='true']").forEach(el => {
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

  const modal = document.getElementById("declarationModal");
  if (modal) modal.style.display = "flex";
}

function closeDeclarationModal() {
  const modal = document.getElementById("declarationModal");
  if (modal) modal.style.display = "none";
}

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}

  if (!res.ok) throw new Error(data.error || text || "Request failed");
  return data;
}

async function save(showAlert = true) {
  const content = editor.getContent();
  const words = wordCount(editor.getContent({ format: "text" }));

  await postJSON("/api/draft/autosave", {
    submissionId,
    content,
    wordCount: words
  });

  setText("save-status", `Saved at ${new Date().toLocaleTimeString()}`);
  if (showAlert) alert("Saved");
}

async function submitWork() {
  if (undeclaredPasteIds.size > 0) {
    alert("You must declare all pasted text before submitting.");
    return;
  }

  await save(false);

  await postJSON("/api/submit", {
    submissionId,
    finalText: editor.getContent()
  });

  alert("Submitted");
  window.location.href = "/student/dashboard";
}

async function saveDeclaration() {
  const explanation = getValue("declarationExplanation").trim();
  if (!explanation) {
    alert("Please explain how you used this material.");
    return;
  }

  const result = await postJSON("/api/declarations", {
    submissionId,
    sessionId: window.APP_DATA?.sessionId || 0,
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
    const span = editor.getBody().querySelector(`[data-paste-id="${CSS.escape(activePasteId)}"]`);
    if (span) {
      span.classList.add("declared-content");
      span.setAttribute("data-declared", "true");
    }
    undeclaredPasteIds.delete(activePasteId);
  }

  if (result.inTextCitation) {
    editor.insertContent(` <sup class="citation-marker">${escapeHtml(result.inTextCitation)}</sup>`);
  }

  await save(false);
  closeDeclarationModal();
  updateStats();
  alert("Declaration saved");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("saveBtn")?.addEventListener("click", () => save(true));
  document.getElementById("submitBtn")?.addEventListener("click", submitWork);
  document.getElementById("declareBtn")?.addEventListener("click", () => openDeclarationModal(""));
  document.getElementById("referenceBtn")?.addEventListener("click", () => {
    const selected = editor?.selection?.getContent({ format: "text" }) || "";
    openDeclarationModal(selected);
  });
  document.getElementById("cancelDeclarationBtn")?.addEventListener("click", closeDeclarationModal);
  document.getElementById("saveDeclarationBtn")?.addEventListener("click", saveDeclaration);

  tinymce.init({
    selector: "#editor",
    height: 680,
    menubar: "file edit insert view format table tools",
    branding: false,
    browser_spellcheck: true,
    plugins: "lists advlist link image media table code wordcount autoresize charmap preview searchreplace visualblocks fullscreen",
    toolbar: [
      "undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | forecolor backcolor",
      "alignleft aligncenter alignright alignjustify | bullist numlist | outdent indent",
      "link image media table | removeformat | preview fullscreen code"
    ],
    toolbar_mode: "sliding",
    paste_as_text: false,
    content_style: `
      body { font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; padding: 12px; }
      .pasted-content, span[data-pasted="true"] { background:#fff3b0!important; border-bottom:2px solid #f59e0b!important; padding:1px 3px; border-radius:4px; }
      .declared-content, span[data-declared="true"] { background:#dcfce7!important; border-bottom:2px solid #16a34a!important; padding:1px 3px; border-radius:4px; }
      .citation-marker { background:#dcfce7!important; border:1px solid #16a34a!important; border-radius:4px; padding:0 3px; font-weight:700; }
      img { max-width:100%; height:auto; }
      table { border-collapse:collapse; width:100%; }
      td, th { border:1px solid #cbd5e1; padding:8px; }
    `,
    setup: (ed) => {
      editor = ed;

      ed.on("init", () => {
        editor.setContent(initialContent || "");

        editor.getBody().querySelectorAll(".pasted-content[data-paste-id]").forEach(el => {
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

        const pasteId = `paste-${Date.now()}`;
        undeclaredPasteIds.add(pasteId);

        editor.insertContent(
          `<span class="pasted-content" data-pasted="true" data-paste-id="${pasteId}">${escapeHtml(text)}</span>`
        );

        openDeclarationModal(text, pasteId);
        updateStats();
      });
    }
  });
});