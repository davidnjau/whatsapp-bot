/* Message templates — staff write messages in plain words and tap chips to
   insert details; each chip is saved as a {{variable}} placeholder, exactly as
   the existing endpoints expect:
     new template  → POST /admin/templates/new   { name, body }
     edit template → POST /admin/templates/<id>  { body }
   Views: # (list) · #new · #edit-<id with - instead of _>
   window.TEMPLATES ([{id, body}]) is injected by the server. */
{
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const icon = id => `<svg class="icon"><use href="#i-${id}"/></svg>`;
  const VAR_RE = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g;

  const DETAILS = {
    name:      { label: "Customer's name", sample: "Wanjiku" },
    order_id:  { label: "Order number", sample: "1234" },
    total:     { label: "Order total", sample: "Ksh 1,350" },
    amount:    { label: "Amount paid", sample: "Ksh 1,350" },
    reference: { label: "Paid for", sample: "order 1234" },
    eta:       { label: "Delivery time", sample: "today between 3pm and 7pm" },
    date:      { label: "Day", sample: "Friday 28 November" },
    time:      { label: "Time", sample: "2:30pm" },
    code:      { label: "Coupon code", sample: "XMAS" },
  };
  const titleCase = s => s.replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, c => c.toUpperCase());
  const labelOf = v => DETAILS[v]?.label || titleCase(v);
  const sampleOf = v => DETAILS[v]?.sample || labelOf(v).toLowerCase();
  const varsOf = body => [...new Set([...String(body).matchAll(VAR_RE)].map(m => m[1]))];

  const FRIENDLY = {
    order_confirmed: ["Order confirmed", "✅"], out_for_delivery: ["Out for delivery", "🚚"],
    payment_received: ["Payment received", "💳"], appointment_reminder: ["Appointment reminder", "📅"],
  };
  const nameOf = id => FRIENDLY[id]?.[0] || titleCase(id);
  const emojiOf = id => FRIENDLY[id]?.[1] || "💬";
  const slug = s => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const hashOf = id => "edit-" + id.replace(/_/g, "-");

  // ---------- Storage (live backend) ----------
  const LIVE = true;
  const DEFAULTS = [
    { id: "appointment_reminder", body: "Hi {{name}}, a reminder about your appointment on {{date}} at {{time}}." },
  ];
  let templates;
  try { templates = window.TEMPLATES; } catch { templates = null; }
  if (!Array.isArray(templates)) templates = structuredClone(DEFAULTS);

  const api = {
    async save({ id, body, isNew }) {
      if (LIVE) {
        const url = isNew ? "/admin/templates/new" : `/admin/templates/${encodeURIComponent(id)}`;
        const params = isNew ? { name: id, body } : { body };
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
          body: new URLSearchParams(params),
        });
        let data = {}; try { data = await res.json(); } catch { /* non-JSON */ }
        if (!res.ok || data.ok === false) throw new Error(data.error || `Server said ${res.status}`);
      }
      const t = templates.find(x => x.id === id);
      if (t) t.body = body; else templates.push({ id, body });
    },
  };

  let toastT;
  function toast(msg, onUndo) {
    const t = $("#toast"), u = t.querySelector("button");
    t.querySelector("span").textContent = msg;
    u.hidden = !onUndo; u.onclick = onUndo ? () => { onUndo(); t.classList.remove("show"); } : null;
    t.classList.add("show"); clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("show"), onUndo ? 6000 : 2400);
  }
  function bodyHtml(body, mode) {
    return esc(body).replace(VAR_RE, (_, v) => mode === "sample"
      ? `<span class="filled">${esc(sampleOf(v))}</span>`
      : `<span class="token small">${esc(labelOf(v))}</span>`);
  }

  // ==========================================================
  // ROUTER
  // ==========================================================
  const drafts = {};
  let editor = null;
  function route() {
    const h = location.hash.slice(1);
    editor = null;
    $("#savebar").classList.remove("visible");
    if (h === "new") return renderEditor(null);
    if (h.startsWith("edit-")) {
      const t = templates.find(x => hashOf(x.id) === h);
      if (t) return renderEditor(t);
    }
    renderList();
  }

  // ==========================================================
  // LIST
  // ==========================================================
  let query = "";
  function renderList() {
    document.title = "Message templates — Dress Nation ~254";
    $("#app").innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Bot</p>
          <h1>Message templates</h1>
          <p class="lede">Ready-made WhatsApp messages for the Notify page. Write them once; staff fill in the details each time they send.</p>
        </div>
        <a class="btn-primary" href="#new">${icon("plus")}New template</a>
      </div>
      <div class="toolbar-row">
        <label class="search">${icon("search")}<input class="input" id="q" type="search" placeholder="Search templates" aria-label="Search templates" value="${esc(query)}" /></label>
        <span class="count" id="count"></span>
      </div>
      <div class="tpl-grid" id="grid"></div>
      <div class="empty" id="empty" hidden></div>`;
    $("#q").addEventListener("input", e => { query = e.target.value; renderCards(); });
    renderCards();
  }
  function renderCards() {
    const q = query.trim().toLowerCase();
    const list = [...templates].sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id)))
      .filter(t => !q || nameOf(t.id).toLowerCase().includes(q) || t.body.toLowerCase().includes(q));
    $("#count").textContent = `${list.length} template${list.length === 1 ? "" : "s"}`;
    $("#empty").hidden = list.length > 0;
    $("#empty").innerHTML = templates.length ? "No templates match your search." : `No templates yet. <a class="link-btn" href="#new">Create your first one</a>`;
    $("#grid").innerHTML = list.map(t => {
      const vars = varsOf(t.body);
      return `<a class="tpl-card" href="#${hashOf(t.id)}" aria-label="Edit ${esc(nameOf(t.id))}">
        <div class="tpl-top"><span class="emoji" aria-hidden="true">${emojiOf(t.id)}</span>
          <div><h2>${esc(nameOf(t.id))}</h2><span class="file-chip">${esc(t.id)}</span></div></div>
        <div class="tpl-msg">${bodyHtml(t.body, "tokens")}</div>
        <div class="tpl-uses">${vars.length ? `Staff fill in ${vars.length} detail${vars.length === 1 ? "" : "s"}` : "No details to fill in"}${drafts[t.id] != null ? ` · <span style="color:var(--wine)">Unsaved changes</span>` : ""}</div>
        <div class="tpl-actions"><span class="link-btn">${icon("edit")}Edit</span>
          <span class="link-btn" data-send="${esc(t.id)}">Send with this ${icon("send")}</span></div>
      </a>`;
    }).join("");
  }
  document.addEventListener("click", e => {
    const s = e.target.closest("[data-send]"); if (!s) return;
    e.preventDefault();
    window.location.href = `/admin/notify?template=${encodeURIComponent(s.dataset.send)}`;
  });

  // ==========================================================
  // EDITOR
  // ==========================================================
  function renderEditor(tpl) {
    const isNew = !tpl;
    document.title = `${isNew ? "New template" : nameOf(tpl.id)} — Dress Nation ~254`;
    const original = tpl ? tpl.body : "";
    const draftKey = isNew ? "__new" : tpl.id;

    $("#app").innerHTML = `
      <a class="back" href="#">${icon("back")}Templates</a>
      <div class="page-head">
        <div>
          <p class="eyebrow">Message template</p>
          <h1 id="title">${isNew ? "New template" : esc(nameOf(tpl.id))}</h1>
          <p class="saved-as" id="savedAs">${isNew ? "Give it a name and write the message." : `Saved as <span class="file-chip">${esc(tpl.id)}</span>`}</p>
        </div>
        ${isNew ? "" : `<a class="btn-outline" href="/admin/notify?template=${encodeURIComponent(tpl.id)}">${icon("send")}Send with this</a>`}
      </div>
      <div class="editor">
        <div class="editor-main">
          ${isNew ? `<section class="card">
            <h2>Name</h2>
            <div class="field">
              <label for="tplName">What is this message for?</label>
              <input class="input" id="tplName" placeholder="e.g. Order cancelled" autocomplete="off" maxlength="60" aria-describedby="idHint" />
              <span class="hint" id="idHint">Staff pick it by this name on the Notify page.</span>
            </div>
          </section>` : ""}
          <section class="card">
            <h2>Message</h2>
            <p class="sub">Write it the way you'd text a customer. Tap a detail to drop it in where your cursor is.</p>
            <div class="field">
              <div class="label-row"><span class="label" id="msgLabel">Message</span><span class="counter" id="counter"></span></div>
              <div class="msg-editor" id="msg" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="msgLabel"
                data-placeholder="Hi …, your order … is ready for pickup!" spellcheck="true"></div>
              <span class="error" id="msgError" hidden></span>
              <div class="inserts" role="group" aria-label="Insert a detail">
                ${Object.entries(DETAILS).map(([v, d]) => `<button type="button" class="ins" data-ins="${v}">${icon("plus")}${esc(d.label)}</button>`).join("")}
                <button type="button" class="ins" id="otherBtn" aria-expanded="false">${icon("plus")}Other detail…</button>
              </div>
              <div class="custom-row" id="customRow" hidden>
                <input class="input" id="customName" placeholder="What is it? e.g. Pickup agent" maxlength="30" aria-label="Name of the new detail" />
                <button type="button" class="btn-outline" id="customAdd">Insert</button>
              </div>
            </div>
            <div class="field">
              <span class="label">Staff will fill in</span>
              <div class="uses" id="uses"></div>
            </div>
            <div class="callout info">${icon("info")}<span>Each detail becomes a box on the Notify page. Staff must fill them all in before sending.</span></div>
            <div class="callout warn" id="changeWarn" hidden>${icon("alert")}<span id="changeText"></span></div>
            <details class="tech"><summary>What gets saved</summary><pre id="raw"></pre></details>
          </section>
        </div>
        <aside class="side">
          <div class="label-row"><span class="label">What the customer sees</span>
            <div class="seg" role="group" aria-label="Preview with">
              <button type="button" data-mode="sample" aria-pressed="true">Example</button>
              <button type="button" data-mode="tokens" aria-pressed="false">Blanks</button>
            </div></div>
          <div class="chat">
            <div class="chat-head"><span class="avatar">W</span><div>Wanjiku<small>+254 712 345 678</small></div></div>
            <div class="chat-body"><div class="bubble" id="bubble"></div></div>
          </div>
          <p class="hint" id="previewHint">Example details are shown in green.</p>
        </aside>
      </div>`;

    const msg = $("#msg");
    let mode = "sample";
    let lastRange = null;
    try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch { /* ignore */ }

    function tokenNode(v) {
      const s = document.createElement("span");
      s.className = "token"; s.contentEditable = "false"; s.dataset.var = v;
      s.append(labelOf(v));
      const b = document.createElement("button");
      b.type = "button"; b.tabIndex = -1; b.textContent = "×"; b.setAttribute("aria-label", `Remove ${labelOf(v)}`);
      s.append(b);
      return s;
    }
    function setBody(body) {
      msg.textContent = "";
      const parts = String(body).split(/(\{\{\s*[A-Za-z_]\w*\s*\}\}|\n)/);
      for (const p of parts) {
        if (!p) continue;
        const m = p.match(/^\{\{\s*([A-Za-z_]\w*)\s*\}\}$/);
        if (m) msg.append(tokenNode(m[1]));
        else if (p === "\n") msg.append(document.createElement("br"));
        else msg.append(document.createTextNode(p));
      }
    }
    function getBody() {
      let out = "";
      const walk = (node) => {
        node.childNodes.forEach((n) => {
          if (n.nodeType === 3) out += n.nodeValue;
          else if (n.nodeType === 1) {
            if (n.dataset.var) out += `{{${n.dataset.var}}}`;
            else if (n.tagName === "BR") out += "\n";
            else if (/^(DIV|P)$/.test(n.tagName)) { if (out && !out.endsWith("\n")) out += "\n"; walk(n); }
            else walk(n);
          }
        });
      };
      walk(msg);
      return out.replace(/ /g, " ").replace(/\}\} +([,.!?;:])/g, "}}$1")
        .replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").replace(/\s+$/, "");
    }
    function tokeniseText() {
      const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
      const hits = [];
      while (walker.nextNode()) if (/\{\{\s*[A-Za-z_]\w*\s*\}\}/.test(walker.currentNode.nodeValue)) hits.push(walker.currentNode);
      let last = null;
      hits.forEach(node => {
        const frag = document.createDocumentFragment();
        node.nodeValue.split(/(\{\{\s*[A-Za-z_]\w*\s*\}\})/).forEach(p => {
          const m = p.match(/^\{\{\s*([A-Za-z_]\w*)\s*\}\}$/);
          if (m) { last = tokenNode(m[1].toLowerCase()); frag.append(last); }
          else if (p) frag.append(document.createTextNode(p));
        });
        node.replaceWith(frag);
      });
      if (last) placeCaretAfter(last);
    }
    function placeCaretAfter(node) {
      const r = document.createRange(); r.setStartAfter(node); r.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); lastRange = r.cloneRange();
    }

    const remember = () => {
      const sel = getSelection();
      if (sel.rangeCount && msg.contains(sel.getRangeAt(0).commonAncestorContainer)) lastRange = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", remember);

    function insertDetail(v) {
      msg.focus();
      const sel = getSelection();
      let r = lastRange && msg.contains(lastRange.commonAncestorContainer) ? lastRange : null;
      if (!r) { r = document.createRange(); r.selectNodeContents(msg); r.collapse(false); }
      sel.removeAllRanges(); sel.addRange(r);
      r.deleteContents();
      const before = textBefore(r);
      const tok = tokenNode(v);
      const frag = document.createDocumentFragment();
      if (before && !/[\s(]$/.test(before)) frag.append(document.createTextNode(" "));
      frag.append(tok, document.createTextNode(" "));
      r.insertNode(frag);
      placeCaretAfter(tok.nextSibling);
      changed();
    }
    function textBefore(r) {
      const pre = document.createRange(); pre.selectNodeContents(msg); pre.setEnd(r.startContainer, r.startOffset);
      return pre.toString();
    }

    msg.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); changed(); }
    });
    msg.addEventListener("paste", e => {
      e.preventDefault();
      document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain"));
      tokeniseText(); changed();
    });
    msg.addEventListener("input", () => { if (/\}\}/.test(msg.textContent)) tokeniseText(); changed(); });
    msg.addEventListener("click", e => {
      const b = e.target.closest(".token button"); if (!b) return;
      const tok = b.closest(".token"); const next = tok.nextSibling;
      if (next?.nodeType === 3 && next.nodeValue.startsWith(" ")) next.nodeValue = next.nodeValue.slice(1);
      tok.remove(); msg.focus(); changed();
    });

    $$(".ins[data-ins]").forEach(b => {
      b.addEventListener("mousedown", e => e.preventDefault());
      b.addEventListener("click", () => insertDetail(b.dataset.ins));
    });
    $("#otherBtn").addEventListener("mousedown", e => e.preventDefault());
    $("#otherBtn").addEventListener("click", () => {
      const row = $("#customRow"); row.hidden = !row.hidden;
      $("#otherBtn").setAttribute("aria-expanded", String(!row.hidden));
      if (!row.hidden) $("#customName").focus();
    });
    const addCustom = () => {
      const v = slug($("#customName").value);
      if (!v || !/^[a-z]/.test(v)) { $("#customName").setAttribute("aria-invalid", "true"); return; }
      $("#customName").value = ""; $("#customName").removeAttribute("aria-invalid");
      $("#customRow").hidden = true; $("#otherBtn").setAttribute("aria-expanded", "false");
      insertDetail(v.slice(0, 30));
    };
    $("#customAdd").addEventListener("click", addCustom);
    $("#customName").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } });

    $$(".seg button").forEach(b => b.addEventListener("click", () => {
      mode = b.dataset.mode; $$(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); paint();
    }));

    const nameIn = $("#tplName");
    if (nameIn) nameIn.addEventListener("input", changed);

    function idNow() { return isNew ? slug(nameIn.value).replace(/^[^a-z]+/, "") : tpl.id; }
    function problems() {
      const p = [];
      if (isNew) {
        const id = idNow();
        if (!nameIn.value.trim()) p.push(["name", "Give the template a name"]);
        else if (!id) p.push(["name", "Use letters in the name"]);
        else if (templates.some(t => t.id === id)) p.push(["name", `"${nameOf(id)}" already exists`]);
      }
      if (!getBody().replace(VAR_RE, "").trim()) p.push(["msg", "Write the message"]);
      return p;
    }
    function paint() {
      const body = getBody(), vars = varsOf(body), p = problems();
      $("#counter").textContent = `${body.replace(VAR_RE, (_, v) => sampleOf(v)).length} characters`;
      $("#uses").innerHTML = vars.length ? vars.map(v => `<span class="token small">${esc(labelOf(v))}</span>`).join("") : `<span class="hint">Nothing. Everyone gets the same message.</span>`;
      $("#raw").textContent = (isNew ? `name: ${idNow() || "—"}\n` : "") + `body:\n${body || "—"}`;
      $("#bubble").className = "bubble" + (body ? "" : " placeholder");
      $("#bubble").innerHTML = body ? `${bodyHtml(body, mode)}<time>${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })}</time>` : "Your message will appear here.";
      $("#previewHint").textContent = mode === "sample" ? "Example details are shown in green." : "These are the boxes staff fill in.";

      const nameErr = p.find(x => x[0] === "name"), msgErr = p.find(x => x[0] === "msg");
      if (isNew) {
        const id = idNow();
        nameIn.setAttribute("aria-invalid", nameErr && nameIn.value.trim() ? "true" : "false");
        $("#idHint").innerHTML = nameErr && nameIn.value.trim() ? `<span class="error">${esc(nameErr[1])}</span>`
          : id ? `Will be saved as <span class="file-chip">${esc(id)}</span>` : "Staff pick it by this name on the Notify page.";
        $("#title").textContent = nameIn.value.trim() || "New template";
      }
      const touched = body !== original;
      msg.setAttribute("aria-invalid", msgErr && touched ? "true" : "false");
      $("#msgError").hidden = !(msgErr && touched); $("#msgError").textContent = msgErr?.[1] || "";

      if (!isNew) {
        const before = varsOf(original), added = vars.filter(v => !before.includes(v)), removed = before.filter(v => !vars.includes(v));
        $("#changeWarn").hidden = !(added.length || removed.length);
        $("#changeText").textContent = [
          added.length ? `Added: ${added.map(labelOf).join(", ")}.` : "",
          removed.length ? `Removed: ${removed.map(labelOf).join(", ")}.` : "",
          "Messages already scheduled with the old version may be missing details.",
        ].filter(Boolean).join(" ");
      }
      return p;
    }

    let raf;
    function changed() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const p = paint();
        const dirty = isNew ? !!(nameIn.value.trim() || getBody()) : getBody() !== original;
        if (dirty) drafts[draftKey] = { name: nameIn?.value || "", body: getBody() }; else delete drafts[draftKey];
        $("#savebar").classList.toggle("visible", dirty);
        $("#saveStatus").classList.toggle("bad", p.length > 0 && dirty);
        $("#saveStatus").textContent = p.length ? p[0][1] : isNew ? "New template" : "Unsaved changes";
        $("#saveBtn").disabled = p.length > 0;
        $("#saveBtn").textContent = isNew ? "Create template" : "Save template";
      });
    }

    editor = {
      async save() {
        if (problems().length) return;
        const id = idNow(), body = getBody();
        const btn = $("#saveBtn"); btn.disabled = true; btn.textContent = "Saving…";
        try {
          await api.save({ id, body, isNew });
          delete drafts[draftKey];
          $("#savebar").classList.remove("visible");
          toast(isNew ? `"${nameOf(id)}" created` : "Template saved");
          location.hash = hashOf(id);
          if (!isNew) route();
        } catch (e) {
          toast("Couldn't save: " + (e.message || "check your connection and try again."));
          btn.disabled = false; btn.textContent = isNew ? "Create template" : "Save template";
        }
      },
      discard() {
        const before = { name: nameIn?.value || "", body: getBody() };
        delete drafts[draftKey];
        if (nameIn) nameIn.value = "";
        setBody(original); changed();
        toast("Changes discarded", () => { if (nameIn) nameIn.value = before.name; setBody(before.body); changed(); });
      },
    };

    const d = drafts[draftKey];
    if (d) { if (nameIn) nameIn.value = d.name; setBody(d.body); toast("Your unsaved changes are back"); }
    else setBody(original);
    paint(); changed();
    (nameIn || msg).focus();
  }

  $("#saveBtn").addEventListener("click", () => editor?.save());
  $("#discardBtn").addEventListener("click", () => editor?.discard());
  window.addEventListener("beforeunload", e => { if (Object.keys(drafts).length) { e.preventDefault(); e.returnValue = ""; } });

  const sidebar = $("#sidebar"), menuBtn = $("#menuBtn");
  menuBtn.addEventListener("click", () => { const o = sidebar.classList.toggle("open"); menuBtn.setAttribute("aria-expanded", String(o)); });
  document.addEventListener("click", e => {
    if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) { sidebar.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); }
  });

  window.addEventListener("hashchange", route);
  route();
}
