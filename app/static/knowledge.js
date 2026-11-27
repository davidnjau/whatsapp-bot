/* Knowledge editor — non-technical editing of the bot's knowledge files.
   business.md / delivery.md → document editor; menu.yaml → form editor.
   Views: # (overview) · #shop-info · #delivery · #whatsapp-menu
   Needs: js-yaml (window.jsyaml) and SEED (file contents injected by the server). */
{
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const icon = id => `<svg class="icon"><use href="#i-${id}"/></svg>`;

  const FILES = [
    { id: "shop-info", file: "business.md", kind: "md", name: "Shop info", icon: "store", who: "ai",
      desc: "Who you are, what you sell, how ordering and payment work, and the rules the assistant must follow." },
    { id: "delivery", file: "delivery.md", kind: "md", name: "Delivery", icon: "truck", who: "ai",
      desc: "Pickup Mtaani options, timing, tracking, collection and what to do about damaged parcels." },
    { id: "whatsapp-menu", file: "menu.yaml", kind: "yaml", name: "WhatsApp menu", icon: "chat", who: "menu",
      desc: "The numbered menu customers see, the welcome message and the automatic replies." },
  ];

  // ---------- Storage (live backend) ----------
  const memory = {}; // file -> { savedAt }
  const api = {
    load(file) { return { text: (SEED[file] ?? ""), savedAt: memory[file]?.savedAt ?? null }; },
    async save(file, text) {
      const res = await fetch(`/admin/knowledge/${file}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ content: text }),
      });
      let data = {}; try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok || data.ok === false) throw new Error(data.error || "save failed");
      SEED[file] = text;                 // the saved file is now the baseline
      memory[file] = { savedAt: Date.now() };
      return { savedAt: memory[file].savedAt };
    },
  };
  const loadFile = f => api.load(f);

  // ---------- App state ----------
  const drafts = {};          // file -> unsaved text, kept when switching pages
  let current = null;         // { meta, editor, baseline }

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  function ago(ts) {
    if (!ts) return null;
    const s = (ts - Date.now()) / 1000, a = Math.abs(s);
    if (a < 45) return "just now";
    if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
    if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
    return rtf.format(Math.round(s / 86400), "day");
  }
  let toastTimer;
  function toast(msg, onUndo) {
    const t = $("#toast"), u = t.querySelector("button");
    t.querySelector("span").textContent = msg;
    u.hidden = !onUndo;
    u.onclick = onUndo ? () => { onUndo(); t.classList.remove("show"); } : null;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), onUndo ? 6000 : 2400);
  }

  // ==========================================================
  // ROUTER
  // ==========================================================
  function route() {
    closeDrawer();
    const meta = FILES.find(f => f.id === location.hash.slice(1));
    current = null;
    $("#savebar").classList.remove("visible");
    if (!meta) return renderOverview();
    renderEditorPage(meta);
    window.scrollTo(0, 0);
  }

  // ==========================================================
  // OVERVIEW
  // ==========================================================
  function renderOverview() {
    document.title = "Knowledge — Dress Nation ~254";
    $("#app").innerHTML = `
      <p class="eyebrow" style="margin-top:0">Bot</p>
      <h1>Knowledge</h1>
      <p class="lede">Everything your WhatsApp bot knows. Edit it like a normal document. We save it in the format the bot needs.</p>
      <div class="callout">${icon("info")}<div>
        <strong>Shop info</strong> and <strong>Delivery</strong> are the AI assistant's only source of truth. If it's not written there, the assistant won't say it.
        The <strong>WhatsApp menu</strong> controls the numbered menu and quick replies.</div></div>
      <div class="kb-grid">
        ${FILES.map(f => {
          const rec = loadFile(f.file);
          const state = drafts[f.file] != null ? `<span style="color:var(--wine)">Unsaved changes</span>` : (rec.savedAt ? `Saved ${ago(rec.savedAt)}` : "Not edited here yet");
          return `<a class="kb-card" href="#${f.id}">
            <span class="icon-circle">${icon(f.icon)}</span>
            <h2>${esc(f.name)}</h2>
            <p>${esc(f.desc)}</p>
            <span class="who ${f.who}">${f.who === "ai" ? icon("sparkle") + "AI assistant reads this" : icon("list") + "Menu bot uses this"}</span>
            <div class="meta"><span>${state}</span><span class="file-chip">${esc(f.file)}</span></div>
          </a>`;
        }).join("")}
      </div>`;
  }

  // ==========================================================
  // EDITOR PAGE (shared header, save bar, drawer)
  // ==========================================================
  function renderEditorPage(meta) {
    document.title = `${meta.name} — Knowledge — Dress Nation ~254`;
    const rec = loadFile(meta.file);
    $("#app").innerHTML = `
      <a class="back" href="#">${icon("back")}Knowledge</a>
      <div class="page-head">
        <div>
          <p class="eyebrow">Knowledge</p>
          <h1>${esc(meta.name)}</h1>
          <p class="lede">${esc(meta.desc)}</p>
          <p class="saved-as">Saved as <span class="file-chip">${esc(meta.file)}</span> · <span id="savedAgo">${rec.savedAt ? `last saved ${ago(rec.savedAt)}` : "loaded from the bot"}</span></p>
        </div>
        <button type="button" class="btn-outline" id="showFile">${icon("code")}Show file</button>
      </div>
      <div class="editor" id="editor"></div>`;

    const factory = meta.kind === "md" ? MdEditor : MenuEditor;
    const editor = factory($("#editor"), meta);
    current = { meta, editor, baseline: "" };

    editor.load(rec.text);
    current.baseline = editor.serialize();
    if (drafts[meta.file] != null && drafts[meta.file] !== current.baseline) {
      editor.load(drafts[meta.file]);
      onChange();
      toast("Your unsaved changes are back");
    } else delete drafts[meta.file];

    $("#showFile").addEventListener("click", openDrawer);
  }

  let changeRaf = 0;
  function onChange() {
    cancelAnimationFrame(changeRaf);
    changeRaf = requestAnimationFrame(() => {
      if (!current) return;
      const text = current.editor.serialize();
      const dirty = text !== current.baseline;
      const problems = current.editor.validate();
      if (dirty) drafts[current.meta.file] = text; else delete drafts[current.meta.file];
      const bar = $("#savebar"), status = $("#saveStatus");
      bar.classList.toggle("visible", dirty);
      status.classList.toggle("bad", problems.length > 0);
      status.textContent = problems.length
        ? `Fix ${problems.length === 1 ? "1 problem" : problems.length + " problems"} to save`
        : "Unsaved changes";
      $("#saveBtn").disabled = problems.length > 0;
      if (drawerOpen) $("#drawerCode").textContent = text;
    });
  }

  $("#saveBtn").addEventListener("click", async () => {
    if (!current || current.editor.validate().length) return;
    const { meta, editor } = current;
    const text = editor.serialize();
    const btn = $("#saveBtn");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const rec = await api.save(meta.file, text);
      current.baseline = text;
      delete drafts[meta.file];
      $("#savedAgo").textContent = `last saved ${ago(rec.savedAt)}`;
      $("#savebar").classList.remove("visible");
      toast(`Saved. The bot now uses the new ${meta.file}`);
    } catch (e) {
      toast("Couldn't save: " + (e.message || "check your connection and try again."));
    } finally {
      btn.disabled = false; btn.textContent = "Save changes";
    }
  });

  $("#discardBtn").addEventListener("click", () => {
    if (!current) return;
    const { meta, editor } = current;
    const before = editor.serialize();
    delete drafts[meta.file];
    editor.load(loadFile(meta.file).text);
    onChange();
    toast("Changes discarded", () => { editor.load(before); onChange(); });
  });

  window.addEventListener("beforeunload", e => {
    if (Object.keys(drafts).length) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- "Show file" drawer ----------
  let drawerOpen = false;
  function openDrawer() {
    if (!current) return;
    drawerOpen = true;
    $("#drawerTitle").textContent = current.meta.file;
    $("#drawerCode").textContent = current.editor.serialize();
    $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false");
    $("#drawerBackdrop").classList.add("open");
    $("#drawerClose").focus();
  }
  function closeDrawer() {
    drawerOpen = false;
    $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true");
    $("#drawerBackdrop").classList.remove("open");
  }
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerBackdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && drawerOpen) closeDrawer(); });
  $("#copyFile").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#drawerCode").textContent); toast("Copied"); }
    catch { toast("Copy isn't allowed here. Select the text instead."); }
  });

  // ==========================================================
  // MARKDOWN  ⇄  EDITOR MODEL
  // ==========================================================
  const inlineMd = text => esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "$1");

  function parseMd(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let title = "";
    const sections = [{ id: uid(), heading: null, raw: [] }];
    for (const line of lines) {
      let m;
      if (!title && sections.length === 1 && !sections[0].raw.some(l => l.trim()) && (m = line.match(/^#\s+(.*)$/))) { title = m[1].trim(); continue; }
      if ((m = line.match(/^##\s+(.*)$/))) { sections.push({ id: uid(), heading: m[1].trim(), raw: [] }); continue; }
      if ((m = line.match(/^#{3,6}\s+(.*)$/))) { sections.at(-1).raw.push("", `**${m[1].trim()}**`, ""); continue; }
      sections.at(-1).raw.push(line);
    }
    return { title, sections: sections.map(s => ({ id: s.id, heading: s.heading, blocks: parseBlocks(s.raw) })) };
  }

  const isTableLine = l => /^\s*\|.*\|\s*$/.test(l);
  const isSepLine = l => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l);

  function parseBlocks(lines) {
    const out = [];
    let rich = [];
    const flush = () => { if (rich.some(l => l.trim())) out.push({ id: uid(), t: "rich", html: mdToHtml(rich) }); rich = []; };
    for (let i = 0; i < lines.length; i++) {
      if (isTableLine(lines[i])) {
        const tl = [];
        while (i < lines.length && isTableLine(lines[i])) tl.push(lines[i++]);
        i--;
        flush();
        const rows = tl.filter(l => !isSepLine(l)).map(splitRow);
        const width = Math.max(...rows.map(r => r.length));
        out.push({ id: uid(), t: "table", rows: rows.map(r => Array.from({ length: width }, (_, k) => inlineMd(r[k] || ""))) });
      } else rich.push(lines[i]);
    }
    flush();
    if (!out.length) out.push({ id: uid(), t: "rich", html: "" });
    return out;
  }

  function splitRow(line) {
    const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = []; let cur = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
      else if (s[i] === "|") { cells.push(cur.trim()); cur = ""; }
      else cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }

  function mdToHtml(lines) {
    const blocks = [];
    let para = null, list = null, prevBlank = true;
    const endPara = () => { if (para) { blocks.push({ t: "p", text: para.join("\n") }); para = null; } };
    const endList = () => { if (list) { blocks.push({ t: "list", items: list }); list = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) { endPara(); endList(); prevBlank = true; continue; }
      const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (m) { endPara(); (list ||= []).push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] }); }
      else if (list && !prevBlank) list.at(-1).text += " " + line.trim();
      else { endList(); (para ||= []).push(line.trim()); }
      prevBlank = false;
    }
    endPara(); endList();
    return blocks.map(b => b.t === "p"
      ? `<p>${b.text.split("\n").map(inlineMd).join(" ")}</p>`
      : listHtml(b.items)).join("");
  }

  function listHtml(items) {
    const root = { indent: -1, children: [] }, stack = [root];
    for (const it of items) {
      while (stack.length > 1 && it.indent <= stack.at(-1).indent) stack.pop();
      const node = { ...it, children: [] };
      stack.at(-1).children.push(node); stack.push(node);
    }
    const render = nodes => {
      if (!nodes.length) return "";
      const tag = nodes[0].ordered ? "ol" : "ul";
      return `<${tag}>${nodes.map(n => `<li>${inlineMd(n.text)}${render(n.children)}</li>`).join("")}</${tag}>`;
    };
    return render(root.children);
  }

  function fragment(html) { const t = document.createElement("template"); t.innerHTML = html; return t.content; }

  const tidy = s => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  const isBoldEl = n => n.tagName === "STRONG" || n.tagName === "B" || /^(bold|[6-9]00)$/.test(n.style?.fontWeight || "");

  function inlineText(node) {
    let s = "";
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) s += n.nodeValue.replace(/[\r\n]+/g, " ");
      else if (n.nodeType === 1) {
        if (n.tagName === "BR") s += "\n";
        else if (n.tagName === "UL" || n.tagName === "OL") { /* lists handled by caller */ }
        else if (isBoldEl(n)) {
          const t = inlineText(n), m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
          s += m[2] ? `${m[1]}**${m[2].replace(/\*\*/g, "")}**${m[3]}` : t;
        } else s += inlineText(n);
      }
    });
    return s;
  }

  function htmlToMd(root) {
    const blocks = [];
    const listLines = (node, pad) => {
      const ordered = node.tagName === "OL";
      const lines = []; let n = 0, lastPad = pad + (ordered ? "   " : "  ");
      [...node.children].forEach(c => {
        if (c.tagName === "LI") {
          n++;
          const marker = ordered ? `${n}. ` : "- ";
          lastPad = pad + " ".repeat(marker.length);
          const text = tidy(inlineText(c)).replace(/\n/g, " ");
          if (text) lines.push(pad + marker + text);
          [...c.children].filter(k => k.tagName === "UL" || k.tagName === "OL").forEach(sub => lines.push(...listLines(sub, lastPad)));
        } else if (c.tagName === "UL" || c.tagName === "OL") {
          lines.push(...listLines(c, lastPad));
        }
      });
      return lines;
    };
    const walk = parent => {
      let loose = "";
      const flushLoose = () => { const t = tidy(loose); if (t) blocks.push(t); loose = ""; };
      parent.childNodes.forEach(n => {
        if (n.nodeType === 3) { loose += n.nodeValue; return; }
        if (n.nodeType !== 1) return;
        if (n.tagName === "UL" || n.tagName === "OL") { flushLoose(); const l = listLines(n, ""); if (l.length) blocks.push(l.join("\n")); }
        else if (n.tagName === "BR") flushLoose();
        else if (/^(P|DIV|H[1-6]|BLOCKQUOTE|SECTION)$/.test(n.tagName)) {
          flushLoose();
          if (n.querySelector("ul,ol,p,div")) walk(n);
          else { const t = tidy(inlineText(n)); if (t) blocks.push(t); }
        } else loose += isBoldEl(n) ? inlineText({ childNodes: [n] }) : inlineText(n);
      });
      flushLoose();
    };
    walk(root);
    return blocks.join("\n\n");
  }

  const cellMd = html => tidy(inlineText(fragment(html))).replace(/\n/g, " ").replace(/\|/g, "\\|");

  function tableMd(rows) {
    if (!rows.length) return "";
    const md = rows.map(r => `| ${r.map(cellMd).join(" | ")} |`);
    md.splice(1, 0, `|${rows[0].map(() => "---").join("|")}|`);
    return md.join("\n");
  }

  function docToMd(doc) {
    let s = `# ${tidy(doc.title) || "Untitled"}\n\n`;
    for (const sec of doc.sections) {
      if (sec.heading !== null) s += `## ${tidy(sec.heading) || "Untitled section"}\n\n`;
      const parts = sec.blocks.map(b => b.t === "rich" ? htmlToMd(fragment(b.html)) : tableMd(b.rows)).filter(Boolean);
      if (parts.length) s += parts.join("\n\n") + "\n\n";
    }
    return s.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  // ==========================================================
  // DOCUMENT EDITOR (for .md files)
  // ==========================================================
  function MdEditor(host, meta) {
    let doc = { title: "", sections: [] };
    let lastSection = null;

    host.innerHTML = `
      <div class="editor-main">
        <div class="card">
          <div class="toolbar" role="toolbar" aria-label="Formatting">
            <button type="button" class="tool" data-cmd="bold" aria-pressed="false" title="Bold (Ctrl+B)"><b>B</b> Bold</button>
            <span class="tool-sep"></span>
            <button type="button" class="tool" data-cmd="insertUnorderedList" aria-pressed="false" title="Bullet list">${icon("list")}Bullets</button>
            <button type="button" class="tool" data-cmd="insertOrderedList" aria-pressed="false" title="Numbered list">${icon("olist")}Numbers</button>
            <button type="button" class="tool" data-cmd="indent" title="Move bullet in">${icon("indent")}</button>
            <button type="button" class="tool" data-cmd="outdent" title="Move bullet out">${icon("outdent")}</button>
            <span class="tool-sep"></span>
            <button type="button" class="tool" data-add-table title="Add a table to the section you're in">${icon("table")}Table</button>
          </div>
          <p class="intro-label">Page title</p>
          <input class="doc-title" id="docTitle" aria-label="Page title" />
        </div>
        <div id="sections" style="display:flex;flex-direction:column;gap:20px"></div>
        <button type="button" class="btn-add" id="addSection">${icon("plus")}Add a section</button>
      </div>
      <aside class="side">
        <div class="card tips">
          <h3>Writing tips</h3>
          <ul>
            <li>Write it like you're briefing a <strong>new shop assistant</strong>.</li>
            <li>Use <strong>Bold</strong> for prices, phone numbers and rules.</li>
            <li>One idea per bullet. Short sentences work best.</li>
            <li>If something isn't written here, the assistant <strong>won't know it</strong>.</li>
          </ul>
        </div>
        <div class="card outline-card">
          <span class="label">Sections</span>
          <ul class="outline" id="outline"></ul>
        </div>
      </aside>`;

    const secHost = $("#sections", host);
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* old browsers */ }

    function render() {
      $("#docTitle", host).value = doc.title;
      secHost.innerHTML = doc.sections.map((s, i) => sectionHtml(s, i)).join("");
      renderOutline();
    }

    function sectionHtml(s, i) {
      const isIntro = s.heading === null;
      const n = doc.sections.length;
      return `<section class="card section-card" data-sid="${s.id}" id="sec-${s.id}">
        ${isIntro ? `<p class="intro-label">Introduction</p>` : `
        <div class="section-head">
          <input data-heading value="${esc(s.heading)}" placeholder="Section title, e.g. Payment" aria-label="Section title" />
          <div class="section-tools">
            <button type="button" class="icon-btn" data-move="-1" aria-label="Move section up" ${i <= 1 ? "disabled" : ""}>${icon("up")}</button>
            <button type="button" class="icon-btn" data-move="1" aria-label="Move section down" ${i >= n - 1 ? "disabled" : ""}>${icon("down")}</button>
            <button type="button" class="icon-btn danger" data-del-section aria-label="Delete section">${icon("trash")}</button>
          </div>
        </div>`}
        ${s.blocks.map(blockHtml).join("")}
      </section>`;
    }

    function blockHtml(b) {
      if (b.t === "rich") {
        return `<div class="block rich" data-bid="${b.id}" contenteditable="true" role="textbox" aria-multiline="true"
          aria-label="Section text" data-placeholder="Start typing…">${b.html}</div>`;
      }
      const cols = b.rows[0]?.length || 0;
      return `<div class="block table-block" data-bid="${b.id}">
        <div class="table-scroll"><table>
          ${b.rows.map((r, ri) => `<tr>
            ${r.map(c => ri === 0
              ? `<th><div contenteditable="true" aria-label="Column title">${c}</div></th>`
              : `<td><div contenteditable="true" aria-label="Table cell">${c}</div></td>`).join("")}
            ${ri === 0 ? `<th class="row-tools" aria-hidden="true"></th>`
              : `<td class="row-tools"><button type="button" class="icon-btn danger" data-del-row="${ri}" aria-label="Delete row">${icon("x")}</button></td>`}
          </tr>`).join("")}
        </table></div>
        <div class="table-foot">
          <button type="button" class="btn-outline" data-add-row>${icon("plus")}Row</button>
          <button type="button" class="btn-outline" data-add-col>${icon("plus")}Column</button>
          <button type="button" class="btn-outline" data-del-col ${cols <= 1 ? "disabled" : ""}>Remove last column</button>
          <button type="button" class="btn-outline" data-del-table style="margin-left:auto">${icon("trash")}Remove table</button>
        </div>
      </div>`;
    }

    function renderOutline() {
      $("#outline", host).innerHTML = doc.sections.map(s =>
        `<li><a href="#" data-goto="${s.id}">${esc(s.heading === null ? "Introduction" : (s.heading || "Untitled section"))}</a></li>`).join("");
    }

    function sync() {
      doc.title = $("#docTitle", host).value;
      $$("[data-sid]", secHost).forEach(el => {
        const s = doc.sections.find(x => x.id === el.dataset.sid); if (!s) return;
        const h = $("[data-heading]", el); if (h) s.heading = h.value;
        $$("[data-bid]", el).forEach(bel => {
          const b = s.blocks.find(x => x.id === bel.dataset.bid); if (!b) return;
          if (b.t === "rich") b.html = bel.innerHTML;
          else b.rows = $$("tr", bel).map(tr => $$("[contenteditable]", tr).map(c => c.innerHTML));
        });
      });
    }
    const findSection = el => doc.sections.find(s => s.id === el.closest("[data-sid]")?.dataset.sid);
    const findBlock = (s, el) => s.blocks.find(b => b.id === el.closest("[data-bid]")?.dataset.bid);
    function restructure(fn, focusSel) { sync(); fn(); render(); onChange(); if (focusSel) $(focusSel, host)?.focus(); }

    host.addEventListener("input", e => {
      if (e.target.matches("[data-heading]")) renderOutlineSoon();
      onChange();
    });
    let outlineT; const renderOutlineSoon = () => { clearTimeout(outlineT); outlineT = setTimeout(() => { sync(); renderOutline(); }, 150); };

    host.addEventListener("paste", e => {
      if (!e.target.closest("[contenteditable]")) return;
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });

    host.addEventListener("focusin", e => { const s = e.target.closest("[data-sid]"); if (s) lastSection = s.dataset.sid; });

    const toolbar = $(".toolbar", host);
    toolbar.addEventListener("mousedown", e => { if (e.target.closest(".tool")) e.preventDefault(); });
    toolbar.addEventListener("click", e => {
      const btn = e.target.closest(".tool"); if (!btn) return;
      if (btn.hasAttribute("data-add-table")) return addTable();
      const active = document.activeElement;
      if (!active?.isContentEditable || !host.contains(active)) { toast("Click into the text first"); return; }
      document.execCommand(btn.dataset.cmd, false, null);
      updateToolState(); onChange();
    });
    function updateToolState() {
      $$(".tool[aria-pressed]", toolbar).forEach(b => {
        let on = false; try { on = document.queryCommandState(b.dataset.cmd); } catch { /* ignore */ }
        b.setAttribute("aria-pressed", String(!!on));
      });
    }
    document.addEventListener("selectionchange", () => { if (current?.editor === api_) updateToolState(); });
    host.addEventListener("keydown", e => {
      if (e.key === "Tab" && e.target.closest(".rich") && document.queryCommandState("insertUnorderedList") + document.queryCommandState("insertOrderedList")) {
        e.preventDefault(); document.execCommand(e.shiftKey ? "outdent" : "indent"); onChange();
      }
    });

    function addTable() {
      sync();
      const s = doc.sections.find(x => x.id === lastSection) || doc.sections.at(-1);
      s.blocks.push({ id: uid(), t: "table", rows: [["Option", "Details"], ["", ""]] });
      render(); onChange();
      $(`[data-sid="${s.id}"] .table-block:last-of-type th [contenteditable]`, host)?.focus();
    }

    host.addEventListener("click", e => {
      const t = e.target.closest("button, a"); if (!t) return;
      const s = findSection(t);
      if (t.dataset.goto) { e.preventDefault(); $(`#sec-${t.dataset.goto}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      if (t.id === "addSection") {
        const ns = { id: uid(), heading: "", blocks: [{ id: uid(), t: "rich", html: "" }] };
        return restructure(() => doc.sections.push(ns), `[data-sid="${ns.id}"] [data-heading]`);
      }
      if (!s) return;
      if (t.dataset.move) {
        return restructure(() => {
          const i = doc.sections.indexOf(s), j = i + Number(t.dataset.move);
          if (j < 1 || j >= doc.sections.length) return;
          [doc.sections[i], doc.sections[j]] = [doc.sections[j], doc.sections[i]];
        });
      }
      if (t.hasAttribute("data-del-section")) {
        sync();
        const i = doc.sections.indexOf(s);
        doc.sections.splice(i, 1); render(); onChange();
        return toast(`"${tidy(s.heading) || "Section"}" deleted`, () => { doc.sections.splice(i, 0, s); render(); onChange(); });
      }
      const b = findBlock(s, t); if (!b || b.t !== "table") return;
      if (t.hasAttribute("data-add-row")) return restructure(() => b.rows.push(b.rows[0].map(() => "")));
      if (t.hasAttribute("data-add-col")) return restructure(() => b.rows.forEach((r, i) => r.push(i === 0 ? "New column" : "")));
      if (t.hasAttribute("data-del-col")) return restructure(() => b.rows.forEach(r => r.length > 1 && r.pop()));
      if (t.dataset.delRow) return restructure(() => b.rows.splice(Number(t.dataset.delRow), 1));
      if (t.hasAttribute("data-del-table")) {
        sync();
        const i = s.blocks.indexOf(b);
        s.blocks.splice(i, 1);
        if (!s.blocks.length) s.blocks.push({ id: uid(), t: "rich", html: "" });
        render(); onChange();
        toast("Table removed", () => { s.blocks.splice(i, 0, b); render(); onChange(); });
      }
    });

    const api_ = {
      load(text) { doc = parseMd(text); render(); },
      serialize() { sync(); return docToMd(doc); },
      validate() {
        sync();
        const p = [];
        if (!tidy(doc.title)) p.push("Add a page title");
        return p;
      },
    };
    return api_;
  }

  // ==========================================================
  // MENU EDITOR (for menu.yaml)
  // ==========================================================
  const MSGS = [
    { key: "greeting", multi: "greetings", label: "Welcome message", hint: "Shown above the menu when a customer says hi." },
    { key: "menu_footer", multi: "menu_footers", label: "Note under the menu", hint: "Shown under the list of options." },
    { key: "language_prompt", label: "Language question", hint: "Sent once, the first time someone messages you." },
    { key: "fallback", label: "When the bot doesn't understand", hint: "The menu is sent again right after this." },
    { key: "after_hours", label: "When you're offline", hint: "Sent outside business hours." },
    { key: "media_ack", label: "When a customer sends a photo", hint: "For screenshots of dresses they like." },
  ];
  const LANGS = [["mix", "Mix"], ["en", "English"], ["sw", "Kiswahili"]];
  const ACTIONS = [
    ["reply", "Send a message", "Replies with the text below"],
    ["catalogue", "Show dresses", "Sends the dress catalogue"],
    ["handoff", "Talk to a person", "Hands the chat to you"],
  ];
  const TOP_KNOWN = ["language_prompt", "greeting", "greetings", "fallback", "menu_footer", "menu_footers", "after_hours", "media_ack", "menu"];
  const ITEM_KNOWN = ["key", "title", "titles", "keywords", "action", "reply", "handoff"];

  const yStr = s => JSON.stringify(String(s ?? ""));
  function yBlock(indent, text) {
    const t = String(text ?? "").replace(/\r\n?/g, "\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
    if (!t) return '""';
    const pad = " ".repeat(indent);
    const head = /^\s/.test(t) ? `|${indent}` : "|";
    return head + "\n" + t.split("\n").map(l => (l.trim() ? pad + l.replace(/\s+$/, "") : "")).join("\n");
  }
  function yWord(w) {
    const s = String(w);
    const plain = /^[\p{L}\p{N}][\p{L}\p{N} '’./_-]*$/u.test(s) && !/\s$/.test(s)
      && !/^(true|false|null|yes|no|on|off|y|n|~)$/i.test(s) && !/^[\d.+-]+$/.test(s);
    return plain ? s : yStr(s);
  }
  const indentDump = (obj, n) => jsyaml.dump(obj, { lineWidth: -1 }).trimEnd().split("\n").map(l => " ".repeat(n) + l).join("\n");
  const hasLang = o => o && (String(o.en ?? "").trim() || String(o.sw ?? "").trim());

  function menuToYaml(m) {
    const L = [];
    L.push("# Shown once, on first contact, to let the customer pick a language.");
    L.push(`language_prompt: ${yBlock(2, m.language_prompt)}`, "");
    L.push("# `greeting` / `title` are the default (Mix). Optional `greetings:` and per-item");
    L.push("# `titles:` give English (en) and Swahili (sw) versions used when the customer");
    L.push("# picks that language.");
    L.push(`greeting: ${yBlock(2, m.greeting)}`);
    if (hasLang(m.greetings)) {
      L.push("greetings:");
      for (const k of ["en", "sw"]) if (String(m.greetings[k] ?? "").trim()) L.push(`  ${k}: ${yBlock(4, m.greetings[k])}`);
    }
    L.push("", `fallback: ${yBlock(2, m.fallback)}`, "");
    L.push("# Appended under the menu list. Reminds customers of the policy and how to");
    L.push("# re-open the menu. Optional en/sw versions; base is Mix.");
    L.push(`menu_footer: ${yBlock(2, m.menu_footer)}`);
    if (hasLang(m.menu_footers)) {
      L.push("menu_footers:");
      for (const k of ["en", "sw"]) if (String(m.menu_footers[k] ?? "").trim()) L.push(`  ${k}: ${yBlock(4, m.menu_footers[k])}`);
    }
    L.push("", `after_hours: ${yBlock(2, m.after_hours)}`, "");
    L.push(`media_ack: ${yBlock(2, m.media_ack)}`, "");

    L.push("menu:");
    (m.menu || []).forEach((it, i) => {
      if (i) L.push("");
      L.push(`  - key: ${yStr(it.key)}`);
      L.push(`    title: ${yStr(it.title)}`);
      if (hasLang(it.titles)) {
        const parts = ["en", "sw"].filter(k => String(it.titles[k] ?? "").trim()).map(k => `${k}: ${yStr(it.titles[k])}`);
        L.push(`    titles: { ${parts.join(", ")} }`);
      }
      const kws = (it.keywords || []).map(String).filter(w => w.trim());
      if (kws.length) L.push(`    keywords: [${kws.map(yWord).join(", ")}]`);
      if (it.handoff) L.push("    handoff: true");
      else if (it.action === "catalogue") L.push("    action: catalogue");
      else {
        if (it.action && it.action !== "reply") L.push(`    action: ${yStr(it.action)}`);
        L.push(`    reply: ${yBlock(6, it.reply)}`);
      }
      const extra = Object.fromEntries(Object.entries(it).filter(([k]) => !ITEM_KNOWN.includes(k) && !k.startsWith("_")));
      if (Object.keys(extra).length) L.push(indentDump(extra, 4));
    });

    const extraTop = Object.fromEntries(Object.entries(m).filter(([k]) => !TOP_KNOWN.includes(k)));
    if (Object.keys(extraTop).length) L.push("", indentDump(extraTop, 0));
    return L.join("\n") + "\n";
  }

  function MenuEditor(host, meta) {
    let m = {};
    let raw = null;
    const open = new Set();
    const msgLang = {};
    const titleLang = {};
    let chatLang = "mix";

    host.innerHTML = `
      <div class="editor-main" id="menuMain"></div>
      <aside class="side">
        <div>
          <div class="label"><span>Try it</span>
            <div class="tabs" role="tablist" aria-label="Customer language" id="chatLangs">
              ${LANGS.map(([k, l]) => `<button type="button" class="tab" role="tab" data-chat-lang="${k}" aria-selected="${k === chatLang}">${l}</button>`).join("")}
            </div>
          </div>
          <div class="chat">
            <div class="chat-head"><span class="avatar">DN</span><div>Dress Nation ~254<small>Test chat · nothing is sent</small></div>
              <button type="button" class="icon-btn" id="chatReset" style="margin-left:auto;background:transparent;border-color:rgb(255 255 255 / .25);color:#fff" aria-label="Restart test chat">${icon("reset")}</button></div>
            <div class="chat-body" id="chatBody" aria-live="polite"></div>
            <form class="chat-input" id="chatForm"><input id="chatIn" placeholder="Type 1, 2… or a word like “delivery”" aria-label="Test message" autocomplete="off" /><button type="submit" aria-label="Send">${icon("send")}</button></form>
          </div>
        </div>
      </aside>`;
    const main = $("#menuMain", host);

    const val = (key, lang, multi) => lang === "mix" ? (m[key] ?? "") : (m[multi]?.[lang] ?? "");
    const setVal = (key, lang, multi, v) => {
      if (lang === "mix") m[key] = v;
      else { m[multi] = m[multi] && typeof m[multi] === "object" ? m[multi] : {}; m[multi][lang] = v; }
    };
    const strip = s => String(s ?? "").replace(/\s+$/, "");
    const typeOf = it => it.handoff ? "handoff" : it.action === "catalogue" ? "catalogue" : "reply";
    const titleFor = (it, lang) => (lang !== "mix" && it.titles?.[lang]) || it.title || "";
    const msgFor = (key, multi, lang) => (lang !== "mix" && multi && strip(m[multi]?.[lang])) || strip(m[key]);

    function problemsOf(it) {
      const p = {};
      const k = String(it.key ?? "").trim();
      if (!k) p.key = "Add a number";
      else if (!/^\d{1,2}$/.test(k)) p.key = "Numbers only";
      else if (m.menu.filter(x => String(x.key).trim() === k).length > 1) p.key = `${k} is used twice`;
      if (!String(it.title ?? "").trim()) p.title = "Add a title";
      if (typeOf(it) === "reply" && !String(it.reply ?? "").trim()) p.reply = "Write the message to send";
      return p;
    }

    function render() {
      if (raw !== null) return renderRaw();
      main.innerHTML = `
        <section class="card">
          <h2>Messages</h2>
          <p class="sub">What the bot says automatically. The Mix version is used unless the customer picked English or Kiswahili.</p>
          <div style="margin-top:18px">${MSGS.map(msgHtml).join("")}</div>
        </section>
        <section class="card">
          <h2>Menu options</h2>
          <p class="sub">Customers reply with the number, or with any of the trigger words.</p>
          <div id="opts" style="margin-top:18px">${m.menu.map(optHtml).join("")}</div>
          <button type="button" class="btn-add" id="addOpt" style="margin-top:12px">${icon("plus")}Add a menu option</button>
        </section>`;
      resetChat();
    }

    function msgHtml(f) {
      const lang = msgLang[f.key] || "mix";
      const v = strip(val(f.key, lang, f.multi));
      const id = `msg-${f.key}`;
      return `<div class="field" data-msg="${f.key}">
        <div class="label-row">
          <label for="${id}">${esc(f.label)}</label>
          ${f.multi ? `<div class="tabs" role="tablist" aria-label="${esc(f.label)} language">
            ${LANGS.map(([k, l]) => `<button type="button" class="tab ${k !== "mix" && strip(m[f.multi]?.[k]) ? "has" : ""}" role="tab" data-msg-lang="${k}" aria-selected="${k === lang}">${l}</button>`).join("")}
          </div>` : ""}
        </div>
        <textarea class="input" id="${id}" data-msg-input rows="${Math.min(6, Math.max(2, v.split("\n").length + 1))}">${esc(v)}</textarea>
        <span class="hint">${esc(f.hint)}${f.multi && lang !== "mix" && !v ? " Leave empty to use the Mix version." : ""}</span>
      </div>`;
    }

    function optHtml(it, i) {
      const p = problemsOf(it), bad = Object.keys(p).length > 0;
      const isOpen = open.has(it._id);
      const type = typeOf(it);
      const lang = titleLang[it._id] || "mix";
      const kws = it.keywords || [];
      const actionLabel = ACTIONS.find(a => a[0] === type)[1];
      return `<div class="opt ${isOpen ? "open" : ""} ${bad ? "invalid" : ""}" data-oid="${it._id}">
        <div class="opt-head" data-toggle role="button" tabindex="0" aria-expanded="${isOpen}">
          <span class="opt-key">${esc(String(it.key ?? "?")) || "?"}</span>
          <span class="opt-title"><b>${esc(it.title || "New option")}</b>
            <small>${bad ? `<span style="color:var(--destructive)">${esc(Object.values(p)[0])}</span>` : `${actionLabel} · ${kws.length} trigger word${kws.length === 1 ? "" : "s"}`}</small></span>
          <svg class="icon opt-chev"><use href="#i-down"/></svg>
        </div>
        ${isOpen ? `<div class="opt-body">
          <div class="opt-row field">
            <div class="field" style="margin:0">
              <label for="k-${it._id}">Number</label>
              <input class="input" id="k-${it._id}" data-f="key" value="${esc(it.key)}" inputmode="numeric" maxlength="2" ${p.key ? 'aria-invalid="true"' : ""} />
              ${p.key ? `<span class="error">${esc(p.key)}</span>` : ""}
            </div>
            <div class="field" style="margin:0">
              <div class="label-row"><label for="t-${it._id}">Title</label>
                <div class="tabs" role="tablist" aria-label="Title language">
                  ${LANGS.map(([k, l]) => `<button type="button" class="tab ${k !== "mix" && it.titles?.[k] ? "has" : ""}" role="tab" data-title-lang="${k}" aria-selected="${k === lang}">${l}</button>`).join("")}
                </div></div>
              <input class="input" id="t-${it._id}" data-f="title" value="${esc(lang === "mix" ? it.title : it.titles?.[lang] ?? "")}"
                placeholder="${lang === "mix" ? "e.g. 🚚 Delivery & fees / Usafirishaji" : "Leave empty to use the Mix title"}" ${p.title && lang === "mix" ? 'aria-invalid="true"' : ""} />
              ${p.title && lang === "mix" ? `<span class="error">${esc(p.title)}</span>` : ""}
            </div>
          </div>
          <div class="field">
            <span class="label" id="a-${it._id}">When a customer picks it</span>
            <div class="tiles" role="radiogroup" aria-labelledby="a-${it._id}">
              ${ACTIONS.map(([k, l, s]) => `<button type="button" class="tile" role="radio" data-action="${k}" aria-checked="${k === type}"><span>${l}</span><small>${s}</small></button>`).join("")}
            </div>
          </div>
          ${type === "reply" ? `<div class="field">
            <label for="r-${it._id}">Message to send</label>
            <textarea class="input" id="r-${it._id}" data-f="reply" rows="5" ${p.reply ? 'aria-invalid="true"' : ""}>${esc(strip(it.reply))}</textarea>
            ${p.reply ? `<span class="error">${esc(p.reply)}</span>` : ""}
          </div>` : ""}
          <div class="field">
            <label for="kw-${it._id}">Trigger words</label>
            <div class="chips" data-chips>
              ${kws.map((w, wi) => `<span class="chip-kw">${esc(w)}<button type="button" data-del-kw="${wi}" aria-label="Remove ${esc(w)}">×</button></span>`).join("")}
              <input id="kw-${it._id}" data-kw-input placeholder="${kws.length ? "Add another…" : "Type a word and press Enter"}" />
            </div>
            <span class="hint">If a customer's message contains any of these, the bot treats it as picking this option.</span>
          </div>
          <div class="opt-foot">
            <div class="moves">
              <button type="button" class="icon-btn" data-omove="-1" aria-label="Move up" ${i === 0 ? "disabled" : ""}>${icon("up")}</button>
              <button type="button" class="icon-btn" data-omove="1" aria-label="Move down" ${i === m.menu.length - 1 ? "disabled" : ""}>${icon("down")}</button>
            </div>
            <button type="button" class="btn-outline" data-del-opt>${icon("trash")}Remove option</button>
          </div>
        </div>` : ""}
      </div>`;
    }

    function renderRaw() {
      main.innerHTML = `<section class="card">
        <h2>This file needs a quick fix</h2>
        <p class="sub" style="color:var(--destructive)">${esc(raw.error)}</p>
        <p class="sub" style="margin-top:8px">You can fix it below, or press <strong>Discard</strong> to go back to the last saved version.</p>
        <textarea class="input" id="rawYaml" rows="24" style="margin-top:14px;font-family:ui-monospace,Menlo,monospace;font-size:13px">${esc(raw.text)}</textarea>
        <button type="button" class="btn-primary" id="tryRaw" style="margin-top:12px">Check again</button>
      </section>`;
      $("#chatBody", host).innerHTML = "";
    }

    function rerenderOpt(it) {
      const el = $(`[data-oid="${it._id}"]`, main); if (!el) return;
      const i = m.menu.indexOf(it);
      const focusId = document.activeElement?.id, pos = document.activeElement?.selectionStart;
      el.outerHTML = optHtml(it, i);
      if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); try { f.setSelectionRange(pos, pos); } catch { /* not text */ } } }
    }

    host.addEventListener("input", e => {
      const t = e.target;
      if (t.id === "rawYaml") { raw.text = t.value; onChange(); return; }
      if (t.matches("[data-msg-input]")) {
        const f = MSGS.find(x => x.key === t.closest("[data-msg]").dataset.msg);
        setVal(f.key, msgLang[f.key] || "mix", f.multi, t.value);
        const tab = $(`[data-msg="${f.key}"] [data-msg-lang="${msgLang[f.key] || "mix"}"]`, main);
        if (tab && tab.dataset.msgLang !== "mix") tab.classList.toggle("has", !!t.value.trim());
        return changed();
      }
      const o = t.closest("[data-oid]"); if (!o) return;
      const it = m.menu.find(x => x._id === o.dataset.oid);
      if (t.dataset.f === "key") { it.key = t.value.replace(/\D/g, ""); if (t.value !== it.key) t.value = it.key; refreshOptHeads(); }
      if (t.dataset.f === "title") {
        const lang = titleLang[it._id] || "mix";
        if (lang === "mix") it.title = t.value; else { it.titles = it.titles || {}; it.titles[lang] = t.value; }
        refreshOptHeads();
      }
      if (t.dataset.f === "reply") it.reply = t.value;
      changed();
    });

    function refreshOptHeads() {
      m.menu.forEach(it => {
        const el = $(`[data-oid="${it._id}"]`, main); if (!el) return;
        const p = problemsOf(it), bad = Object.keys(p).length > 0, type = typeOf(it), kws = it.keywords || [];
        el.classList.toggle("invalid", bad);
        $(".opt-key", el).textContent = String(it.key ?? "") || "?";
        $(".opt-title b", el).textContent = it.title || "New option";
        $(".opt-title small", el).innerHTML = bad ? `<span style="color:var(--destructive)">${esc(Object.values(p)[0])}</span>`
          : `${ACTIONS.find(a => a[0] === type)[1]} · ${kws.length} trigger word${kws.length === 1 ? "" : "s"}`;
        const keyIn = $('[data-f="key"]', el);
        if (keyIn) { keyIn.setAttribute("aria-invalid", p.key ? "true" : "false"); }
      });
    }

    host.addEventListener("click", e => {
      const t = e.target.closest("button, [data-toggle], [data-chips]"); if (!t) return;
      if (t.dataset.chatLang) { chatLang = t.dataset.chatLang; $$("[data-chat-lang]", host).forEach(b => b.setAttribute("aria-selected", String(b === t))); return resetChat(); }
      if (t.id === "chatReset") return resetChat();
      if (t.id === "tryRaw") return tryRaw();
      if (t.dataset.msgLang) { const k = t.closest("[data-msg]").dataset.msg; msgLang[k] = t.dataset.msgLang; const f = MSGS.find(x => x.key === k); t.closest("[data-msg]").outerHTML = msgHtml(f); $(`#msg-${k}`, main)?.focus(); return; }
      if (t.id === "addOpt") {
        const used = new Set(m.menu.map(x => String(x.key)));
        let k = 1; while (used.has(String(k)) && k < 99) k++;
        const it = { _id: uid(), key: String(k), title: "", titles: {}, keywords: [], reply: "" };
        m.menu.push(it); open.add(it._id);
        $("#opts", main).insertAdjacentHTML("beforeend", optHtml(it, m.menu.length - 1));
        $(`#t-${it._id}`, main)?.focus();
        return changed(true);
      }
      const o = t.closest("[data-oid]"); if (!o) return;
      const it = m.menu.find(x => x._id === o.dataset.oid);
      if (t.dataset.toggle !== undefined && t.matches("[data-toggle]")) { open.has(it._id) ? open.delete(it._id) : open.add(it._id); return rerenderOpt(it); }
      if (t.dataset.titleLang) { titleLang[it._id] = t.dataset.titleLang; rerenderOpt(it); $(`#t-${it._id}`, main)?.focus(); return; }
      if (t.dataset.action) {
        const a = t.dataset.action;
        delete it.handoff; delete it.action;
        if (a === "handoff") it.handoff = true;
        if (a === "catalogue") it.action = "catalogue";
        rerenderOpt(it); return changed();
      }
      if (t.dataset.delKw !== undefined) { it.keywords.splice(Number(t.dataset.delKw), 1); rerenderOpt(it); $(`#kw-${it._id}`, main)?.focus(); return changed(); }
      if (t.matches("[data-chips]")) { $("[data-kw-input]", t)?.focus(); return; }
      if (t.dataset.omove) {
        const i = m.menu.indexOf(it), j = i + Number(t.dataset.omove);
        if (j < 0 || j >= m.menu.length) return;
        [m.menu[i], m.menu[j]] = [m.menu[j], m.menu[i]];
        render(); return changed();
      }
      if (t.hasAttribute("data-del-opt")) {
        const i = m.menu.indexOf(it);
        m.menu.splice(i, 1); render(); changed();
        toast(`Option ${it.key} removed`, () => { m.menu.splice(i, 0, it); render(); changed(); });
      }
    });

    host.addEventListener("keydown", e => {
      const t = e.target;
      if (t.matches("[data-toggle]") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.click(); return; }
      if (t.matches("[data-kw-input]")) {
        const it = m.menu.find(x => x._id === t.closest("[data-oid]").dataset.oid);
        if ((e.key === "Enter" || e.key === ",") && t.value.trim()) {
          e.preventDefault();
          const words = t.value.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
          it.keywords = it.keywords || [];
          words.forEach(w => { if (!it.keywords.includes(w)) it.keywords.push(w); });
          rerenderOpt(it); $(`#kw-${it._id}`, main)?.focus(); changed();
        } else if (e.key === "Backspace" && !t.value && it.keywords?.length) {
          it.keywords.pop(); rerenderOpt(it); $(`#kw-${it._id}`, main)?.focus(); changed();
        } else if (e.key === "Enter") e.preventDefault();
      }
    });
    host.addEventListener("focusout", e => {
      const t = e.target;
      if (!t.matches?.("[data-kw-input]") || !t.value.trim()) return;
      const it = m.menu.find(x => x._id === t.closest("[data-oid]").dataset.oid);
      t.value.split(",").map(w => w.trim().toLowerCase()).filter(Boolean).forEach(w => { if (!it.keywords.includes(w)) it.keywords.push(w); });
      t.value = ""; setTimeout(() => { rerenderOpt(it); changed(); });
    });

    let chatT;
    function changed() { onChange(); clearTimeout(chatT); chatT = setTimeout(resetChat, 400); }

    function tryRaw() {
      try { load(raw.text, true); toast("Looks good now"); }
      catch (e) { raw.error = friendlyYamlError(e); renderRaw(); }
      onChange();
    }

    const now = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
    function bubble(text, who = "in") {
      const body = $("#chatBody", host);
      body.insertAdjacentHTML("beforeend", `<div class="bubble ${who}">${esc(text)}${who === "note" ? "" : `<time>${now()}</time>`}</div>`);
      body.scrollTop = body.scrollHeight;
    }
    function menuMessage() {
      const greet = msgFor("greeting", "greetings", chatLang);
      const list = m.menu.map(it => `${it.key}. ${titleFor(it, chatLang)}`).join("\n");
      const foot = msgFor("menu_footer", "menu_footers", chatLang);
      return [greet, list, foot].filter(Boolean).join("\n\n");
    }
    function resetChat() {
      if (raw !== null) return;
      $("#chatBody", host).innerHTML = "";
      bubble("hi", "out");
      bubble(menuMessage());
    }
    $("#chatForm", host).addEventListener("submit", e => {
      e.preventDefault();
      const input = $("#chatIn", host), text = input.value.trim();
      if (!text || raw !== null) return;
      input.value = "";
      bubble(text, "out");
      const low = text.toLowerCase();
      setTimeout(() => {
        if (low === "menu") return bubble(menuMessage());
        const it = m.menu.find(x => String(x.key) === low)
          || m.menu.find(x => (x.keywords || []).some(w => low.includes(String(w).toLowerCase())));
        if (!it) return bubble(`${strip(m.fallback)}\n\n${m.menu.map(x => `${x.key}. ${titleFor(x, chatLang)}`).join("\n")}`);
        const type = typeOf(it);
        if (type === "reply") bubble(strip(it.reply) || "(No message written yet)");
        else bubble(type === "catalogue" ? "The bot sends the dress catalogue here." : "The chat is handed to you (the shop owner).", "note");
      }, 350);
    });

    function friendlyYamlError(e) {
      const line = e?.mark ? ` (around line ${e.mark.line + 1})` : "";
      return `The file has a formatting problem${line}: ${e.reason || e.message}`;
    }
    function load(text, strict) {
      let data;
      try { data = jsyaml.load(text) || {}; if (typeof data !== "object" || Array.isArray(data)) throw new Error("Expected settings, found something else."); }
      catch (e) { if (strict) throw e; raw = { text, error: friendlyYamlError(e) }; render(); return; }
      raw = null;
      m = data;
      m.menu = Array.isArray(m.menu) ? m.menu : [];
      m.menu.forEach(it => {
        Object.defineProperty(it, "_id", { value: uid(), enumerable: false, writable: true });
        it.key = String(it.key ?? "");
        it.keywords = Array.isArray(it.keywords) ? it.keywords.map(String) : [];
      });
      open.clear();
      render();
    }

    return {
      load(text) { load(text, false); },
      serialize() { return raw !== null ? raw.text : menuToYaml(m); },
      validate() {
        if (raw !== null) return [raw.error];
        const p = [];
        m.menu.forEach(it => p.push(...Object.values(problemsOf(it))));
        if (!m.menu.length) p.push("Add at least one menu option");
        return p;
      },
    };
  }

  // ==========================================================
  // Mobile sidebar + start
  // ==========================================================
  const sidebar = $("#sidebar"), menuBtn = $("#menuBtn");
  menuBtn.addEventListener("click", () => { const o = sidebar.classList.toggle("open"); menuBtn.setAttribute("aria-expanded", String(o)); });
  document.addEventListener("click", e => {
    if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) { sidebar.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); }
  });

  window.addEventListener("hashchange", route);
  route();
}
