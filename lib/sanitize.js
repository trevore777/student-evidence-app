import sanitizeHtml from "sanitize-html";

export function sanitizeRichText(html = "") {
  return sanitizeHtml(String(html), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "span",
      "img",
      "p", "br", "strong", "b", "em", "i", "u",
  "ul", "ol", "li", "blockquote",
  "h1", "h2", "h3", "h4",
  "table", "thead", "tbody", "tr", "th", "td",
  "a", "span", "img", "section", "hr"
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
  span: ["class", "data-pasted"],
  img: ["src", "alt", "width", "height", "style"],
  section: ["id"],
  ol: ["id"],
  li: ["id", "class"]
    },
    allowedClasses: {
      span: ["pasted-content", "citation-marker"]
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer"
      })
    },
    disallowedTagsMode: "discard"
  });
}