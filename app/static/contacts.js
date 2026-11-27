/* Contacts — searchable list + "Add contacts" drawer that accepts numbers in
   any format and posts the same CSV the server expects:
     POST /admin/contacts/import  csv="0712345678,Wanjiku\n0722111222,Akinyi"
   window.CONTACTS / window.CONTACTS_FLASH come from the server. */
{
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const icon = id => `<svg class="icon"><use href="#i-${id}"/></svg>`;
  const LIVE = true;
  const PAGE = 50;

  function normalisePhone(input) {
    let d = String(input).replace(/\D/g, "");
    if (d.startsWith("0") && d.length === 10) d = "254" + d.slice(1);
    else if (/^[17]\d{8}$/.test(d)) d = "254" + d;
    return /^254[17]\d{8}$/.test(d) ? d : null;
  }
  const pretty = d => `+254 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  const local = d => "0" + d.slice(3);

  const now = Date.now(), day = 864e5;
  const SAMPLE = [
    ["Wanjiku", "0700000101", true, "inbound", 1], ["Akinyi", "0700000102", true, "inbound", 2],
    ["", "0700000103", true, "inbound", 3], ["Njeri M.", "0700000104", false, "inbound", 9],
    ["Achieng", "0700000105", true, "import", 12], ["", "0700000108", false, "import", 30],
  ].map(([name, phone, optIn, source, ago]) => ({ name, phone, optIn, source, added: now - ago * day }));
  const isSample = !Array.isArray(window.CONTACTS);
  let contacts = (window.CONTACTS || SAMPLE).map(c => ({ ...c, phone: normalisePhone(c.phone) || String(c.phone).replace(/\D/g, "") }));
  $("#sampleNote").hidden = !isSample;

  const view = { q: "", status: "all", source: "all", limit: PAGE };
  const SOURCE_LABEL = { inbound: "Messaged you", import: "Added by you", csv: "Added by you" };
  const sourceLabel = s => SOURCE_LABEL[s] || String(s || "Unknown").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());

  function matches(c) {
    if (view.status === "in" && !c.optIn) return false;
    if (view.status === "out" && c.optIn) return false;
    if (view.source === "import" && c.source !== "import" && c.source !== "csv") return false;
    if (view.source === "inbound" && c.source !== "inbound") return false;
    const q = view.q.trim().toLowerCase();
    if (!q) return true;
    const digits = q.replace(/\D/g, "").replace(/^0|^254/, "");
    return (c.name || "").toLowerCase().includes(q) || (digits.length >= 3 && c.phone.includes(digits));
  }

  function render() {
    const inCount = contacts.filter(c => c.optIn).length;
    $("#sTotal").textContent = contacts.length.toLocaleString();
    $("#sIn").textContent = inCount.toLocaleString();
    $("#sOut").textContent = (contacts.length - inCount).toLocaleString();
    $("#sWeek").textContent = contacts.filter(c => c.added && now - c.added < 7 * day).length.toLocaleString();

    const list = contacts.filter(matches).sort((a, b) => (b.added || 0) - (a.added || 0));
    const shown = list.slice(0, view.limit);
    $("#rows").innerHTML = shown.map(c => `
      <div class="row" role="listitem">
        <div class="person"><span class="avatar" aria-hidden="true">${esc(c.name ? c.name.trim()[0].toUpperCase() : "#")}</span>
          <b class="${c.name ? "" : "noname"}">${esc(c.name || "No name")}</b></div>
        <span class="phone">${esc(c.phone.length === 12 ? pretty(c.phone) : c.phone)}</span>
        <span class="chip ${c.optIn ? "in" : "out"}">${c.optIn ? "Can message" : "Said STOP"}</span>
        <span class="src">${esc(sourceLabel(c.source))}</span>
        <span class="row-actions">
          <a class="icon-btn" href="/admin/notify?phone=${encodeURIComponent(local(c.phone))}${c.name ? `&name=${encodeURIComponent(c.name)}` : ""}"
             title="${c.optIn ? "Send a notification" : "Can't message: they said STOP"}" aria-label="Message ${esc(c.name || pretty(c.phone))}"
             ${c.optIn ? "" : 'aria-disabled="true" tabindex="-1"'}>${icon("send")}</a>
          <button type="button" class="icon-btn" data-copy="${esc(local(c.phone))}" title="Copy number" aria-label="Copy number for ${esc(c.name || pretty(c.phone))}">${icon("copy")}</button>
        </span>
      </div>`).join("");
    const filtered = view.q || view.status !== "all" || view.source !== "all";
    $("#empty").hidden = list.length > 0;
    $("#empty").innerHTML = contacts.length ? "No contacts match. Try a different search or filter."
      : "No contacts yet. People appear here when they message your WhatsApp, or press <strong>Add contacts</strong>.";
    $("#showing").textContent = list.length ? `Showing ${shown.length} of ${list.length}${filtered ? " matching" : ""}` : "";
    $("#more").hidden = shown.length >= list.length;
  }

  let qT;
  $("#q").addEventListener("input", e => { clearTimeout(qT); qT = setTimeout(() => { view.q = e.target.value; view.limit = PAGE; render(); }, 120); });
  const pillGroup = (sel, key) => $(sel).addEventListener("click", e => {
    const b = e.target.closest(".pill"); if (!b) return;
    view[key] = b.dataset[key]; view.limit = PAGE;
    $$(".pill", $(sel)).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });
  pillGroup("#statusPills", "status");
  pillGroup("#sourcePills", "source");
  $("#more").addEventListener("click", () => { view.limit += PAGE; render(); });
  $("#rows").addEventListener("click", async e => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); toast(`Copied ${b.dataset.copy}`); }
    catch { toast("Copy isn't allowed here"); }
  });

  // ==========================================================
  // ADD CONTACTS
  // ==========================================================
  const drawer = $("#drawer"), backdrop = $("#backdrop");
  let lastFocus = null;
  function openDrawer() {
    lastFocus = document.activeElement;
    drawer.classList.add("open"); backdrop.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
    setTimeout(() => $("#paste").focus(), 50);
  }
  function closeDrawer() {
    drawer.classList.remove("open"); backdrop.classList.remove("open"); drawer.setAttribute("aria-hidden", "true");
    lastFocus?.focus();
  }
  $("#openAdd").addEventListener("click", openDrawer);
  $("#closeAdd").addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => {
    if (!drawer.classList.contains("open")) return;
    if (e.key === "Escape") closeDrawer();
    if (e.key === "Tab") {
      const f = $$('button:not([disabled]), textarea, input:not([type=hidden]), [href], summary', drawer).filter(x => x.offsetParent !== null);
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });

  $$(".tab").forEach(t => t.addEventListener("click", () => setTab(t.id === "tabFile" ? "file" : "paste")));
  function setTab(which) {
    $("#tabPaste").setAttribute("aria-selected", String(which === "paste"));
    $("#tabFile").setAttribute("aria-selected", String(which === "file"));
    $("#panePaste").hidden = which !== "paste";
    $("#paneFile").hidden = which !== "file";
  }

  const dz = $("#dropzone");
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", e => readFile(e.dataTransfer.files[0]));
  $("#file").addEventListener("change", e => readFile(e.target.files[0]));
  function readFile(file) {
    if (!file) return;
    if (/\.(xlsx?|numbers)$/i.test(file.name)) { toast("Save it as CSV first (File → Download → .csv)"); return; }
    const r = new FileReader();
    r.onload = () => { $("#paste").value = String(r.result); setTab("paste"); toast(`Loaded ${file.name}`); check(); };
    r.readAsText(file);
  }

  function parseLine(line) {
    const raw = line.trim();
    if (!raw) return null;
    const m = raw.match(/\+?\d[\d\s\-().]{7,}\d/);
    if (!m) {
      if (/^(phone|number|namba|simu|name|jina)\b/i.test(raw)) return null;
      return { raw, phone: null, name: "", status: "bad", why: "No phone number found" };
    }
    const phone = normalisePhone(m[0]);
    const name = (raw.slice(0, m.index) + " " + raw.slice(m.index + m[0].length))
      .replace(/["']/g, "").replace(/[,;\t|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!phone) return { raw, phone: null, name, status: "bad", why: "Not a Kenyan mobile number" };
    return { raw, phone, name, status: "ok" };
  }

  let parsed = [];
  function check() {
    const known = new Map(contacts.map(c => [c.phone, c]));
    const seen = new Set();
    parsed = $("#paste").value.split(/\r?\n/).map(parseLine).filter(Boolean).map(r => {
      if (r.status === "bad") return r;
      if (seen.has(r.phone)) return { ...r, status: "skip", why: "Listed twice, added once" };
      seen.add(r.phone);
      const k = known.get(r.phone);
      if (k && !k.optIn) return { ...r, status: "out", why: "Said STOP before, stays opted out" };
      if (k) return { ...r, status: "dup", why: "Already in your contacts" };
      return r;
    });

    const n = s => parsed.filter(r => r.status === s).length;
    const ok = n("ok"), dup = n("dup"), out = n("out"), bad = n("bad"), skip = n("skip");
    $("#checkCard").hidden = parsed.length === 0;
    $("#checkSummary").innerHTML = [
      ok && `<span class="sum ok">✓ ${ok} new</span>`,
      dup && `<span class="sum dup">${dup} already added</span>`,
      out && `<span class="sum out">${out} said STOP</span>`,
      (bad + skip) && `<span class="sum bad">${bad + skip} won't be added</span>`,
    ].filter(Boolean).join("");
    const TAG = { ok: "Ready", dup: "Already added", out: "Stays opted out", bad: "Fix or remove", skip: "Duplicate" };
    const MARK = { ok: "✓", dup: "•", out: "!", bad: "✕", skip: "✕" };
    $("#checkList").innerHTML = parsed.map(r => `
      <li class="${r.status === "skip" ? "bad" : r.status}">
        <span class="mark" aria-hidden="true">${MARK[r.status]}</span>
        <span class="what"><b>${esc(r.name || (r.phone ? "No name" : r.raw))}</b>
          <small>${r.phone ? esc(pretty(r.phone)) : esc(r.raw)}${r.why ? " · " + esc(r.why) : ""}</small></span>
        <span class="tag">${TAG[r.status]}</span>
      </li>`).join("");

    const send = parsed.filter(r => ["ok", "dup", "out"].includes(r.status));
    const csv = send.map(r => `${local(r.phone)}${r.name ? "," + r.name.replace(/,/g, " ") : ""}`).join("\n");
    $("#csvField").value = csv;
    $("#csvOut").textContent = csv || "—";

    const consent = $("#consent").checked;
    $("#addBtn").disabled = !ok || !consent;
    $("#addBtn span").textContent = ok ? `Add ${ok} contact${ok === 1 ? "" : "s"}` : "Add contacts";
    $("#footHint").textContent = !parsed.length ? "Paste some numbers to start."
      : !ok ? "No new numbers to add."
      : !consent ? "Tick the box to confirm they agreed."
      : (bad + skip) ? `${bad + skip} line${bad + skip === 1 ? "" : "s"} won't be added.` : "All set.";
  }
  let cT;
  $("#paste").addEventListener("input", () => { clearTimeout(cT); cT = setTimeout(check, 150); });
  $("#consent").addEventListener("change", check);

  $("#addBtn").addEventListener("click", async () => {
    check();
    if ($("#addBtn").disabled) return;
    if (LIVE) { $("#importForm").submit(); return; }
    const btn = $("#addBtn"); btn.disabled = true; btn.querySelector("span").textContent = "Adding…";
    await new Promise(r => setTimeout(r, 400));
    const fresh = parsed.filter(r => r.status === "ok");
    fresh.forEach(r => contacts.push({ phone: r.phone, name: r.name, optIn: true, source: "import", added: Date.now() }));
    $("#paste").value = ""; $("#consent").checked = false; check();
    closeDrawer(); render();
    toast(`Added ${fresh.length} contact${fresh.length === 1 ? "" : "s"}`);
  });

  let tt;
  function toast(msg) { const t = $("#toast"); t.querySelector("span").textContent = msg; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2600); }

  const sidebar = $("#sidebar"), menuBtn = $("#menuBtn");
  menuBtn.addEventListener("click", () => { const o = sidebar.classList.toggle("open"); menuBtn.setAttribute("aria-expanded", String(o)); });
  document.addEventListener("click", e => {
    if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) { sidebar.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); }
  });

  render();
  check();
  if (window.CONTACTS_FLASH && window.CONTACTS_FLASH.text) toast(window.CONTACTS_FLASH.text);
}
