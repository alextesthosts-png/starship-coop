// Tiny, safe text formatting used for admin-edited content (landing sections, changelog).
// Everything is HTML-escaped first; only a few markers are turned back into tags:
//   **bold**   *italic*   `code`   [link text](https://example.com)
//   lines starting with "- " become a bulleted list, "## " a heading, blank lines split paragraphs.

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  return s;
}

export function render(text) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-•]\s+/.test(line)) { flushPara(); (list ||= []).push(line.replace(/^\s*[-•]\s+/, '')); continue; }
    if (/^##\s+/.test(line)) { flushPara(); flushList(); out.push(`<h4>${inline(line.replace(/^##\s+/, ''))}</h4>`); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('');
}
