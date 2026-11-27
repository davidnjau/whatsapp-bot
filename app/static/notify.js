/* Send a notification — staff pick a message and fill in plain boxes; the page
   builds the same fields the server expects: phone (2547…), template, variables
   (JSON), sendAt (Nairobi or empty). Prefill via ?phone=&template=&name=…
   window.TEMPLATES / window.NOTIFY_LOG / window.NOTIFY_FLASH come from the server. */
{
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const TZ = "Africa/Nairobi";
  const LIVE = true;

  const TEMPLATES = Array.isArray(window.TEMPLATES) && window.TEMPLATES.length ? window.TEMPLATES : [
    { id: "order_confirmed", body: "Hi {{name}}, your order {{order_id}} is confirmed! Total: {{total}}." },
    { id: "out_for_delivery", body: "Hi {{name}}, your order {{order_id}} is out for delivery and should reach you {{eta}}." },
    { id: "payment_received", body: "Hi {{name}}, we've received your payment of {{amount}} for {{reference}}. Asante! 🙏" },
    { id: "appointment_reminder", body: "Hi {{name}}, a reminder about your appointment on {{date}} at {{time}}." },
  ];
  const FRIENDLY = {
    order_confirmed: ["Order confirmed", "✅"], out_for_delivery: ["Out for delivery", "🚚"],
    payment_received: ["Payment received", "💳"], appointment_reminder: ["Appointment reminder", "📅"],
  };
  const nameOf = id => FRIENDLY[id]?.[0] || id.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
  const emojiOf = id => FRIENDLY[id]?.[1] || "💬";
  const varsOf = body => [...new Set([...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))];

  const FIELDS = {
    name:      { label: "Customer's first name", placeholder: "Wanjiku" },
    order_id:  { label: "Order number", placeholder: "1234", hint: "As shown on the Orders page" },
    total:     { label: "Order total", money: true, hint: "Dress price plus delivery" },
    amount:    { label: "Amount paid", money: true },
    reference: { label: "Paid for", placeholder: "order 1234", hint: "An order number or what the payment was for" },
    date:      { label: "Day", type: "date" },
    time:      { label: "Time", type: "time" },
    eta:       { label: "When it should arrive", placeholder: "today between 3pm and 7pm",
                 quick: ["today", "tomorrow", "today between 3pm and 7pm", "tomorrow between 10am and 3pm"] },
  };
  const labelFor = v => FIELDS[v]?.label || v.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());

  const state = { template: null, raw: {}, phone: null };

  function normalisePhone(input) {
    let d = String(input).replace(/\D/g, "");
    if (d.startsWith("0") && d.length === 10) d = "254" + d.slice(1);
    else if (/^[17]\d{8}$/.test(d)) d = "254" + d;
    return /^254[17]\d{8}$/.test(d) ? d : null;
  }
  const prettyPhone = d => `+254 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;

  $("#phone").addEventListener("input", () => { state.phone = normalisePhone($("#phone").value); update(); });
  $("#phone").addEventListener("blur", () => {
    if (state.phone) $("#phone").value = "0" + state.phone.slice(3).replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
    update(true);
  });

  $("#templates").innerHTML = TEMPLATES.map(t => `
    <button type="button" class="tpl" role="radio" aria-checked="false" data-tpl="${esc(t.id)}">
      <span class="tpl-name"><span class="tpl-emoji" aria-hidden="true">${emojiOf(t.id)}</span>${esc(nameOf(t.id))}</span>
      <span class="tpl-body">${esc(t.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v) => `[${labelFor(v).toLowerCase()}]`))}</span>
    </button>`).join("");

  $("#templates").addEventListener("click", e => {
    const b = e.target.closest("[data-tpl]"); if (!b) return;
    selectTemplate(b.dataset.tpl, true);
  });
  $("#templates").addEventListener("keydown", e => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    const tiles = $$("[data-tpl]"), i = tiles.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = tiles[(i + (/Right|Down/.test(e.key) ? 1 : -1) + tiles.length) % tiles.length];
    n.focus(); selectTemplate(n.dataset.tpl, false);
  });

  function selectTemplate(id, focusFirst) {
    state.template = TEMPLATES.find(t => t.id === id) || null;
    $$("[data-tpl]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.tpl === id)));
    renderVars();
    update();
    if (focusFirst) $("#vars input")?.focus();
  }

  function renderVars() {
    const t = state.template;
    $("#varsWrap").hidden = !t;
    if (!t) return;
    $("#vars").innerHTML = varsOf(t.body).map(v => {
      const f = FIELDS[v] || {};
      const val = state.raw[v] ?? "";
      const id = `v-${v}`;
      let control;
      if (f.money) control = `<div class="prefix-wrap"><span>Ksh</span><input id="${id}" data-var="${v}" inputmode="numeric" placeholder="1,000" value="${esc(val)}" /></div>`;
      else if (f.type === "date") control = `<input class="input" id="${id}" data-var="${v}" type="date" value="${esc(val)}" />`;
      else if (f.type === "time") control = `<input class="input" id="${id}" data-var="${v}" type="time" value="${esc(val)}" />`;
      else control = `<input class="input" id="${id}" data-var="${v}" placeholder="${esc(f.placeholder || "")}" value="${esc(val)}" autocomplete="off" />`;
      const quick = f.quick ? `<div class="quick" role="group" aria-label="Quick picks">${f.quick.map(q => `<button type="button" data-quick="${v}" data-val="${esc(q)}" aria-pressed="${q === val}">${esc(q)}</button>`).join("")}</div>` : "";
      return `<div class="field" ${f.quick ? 'style="grid-column:1/-1"' : ""}>
        <label for="${id}">${esc(labelFor(v))}</label>${control}${quick}
        ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}
      </div>`;
    }).join("");
  }

  $("#vars").addEventListener("input", e => {
    const i = e.target.closest("[data-var]"); if (!i) return;
    const v = i.dataset.var;
    if (FIELDS[v]?.money) {
      const digits = i.value.replace(/\D/g, "").slice(0, 9);
      i.value = digits ? Number(digits).toLocaleString("en-KE") : "";
    }
    state.raw[v] = i.value;
    $$(`[data-quick="${v}"]`).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.val === i.value)));
    update();
  });
  $("#vars").addEventListener("click", e => {
    const b = e.target.closest("[data-quick]"); if (!b) return;
    const v = b.dataset.quick;
    state.raw[v] = b.dataset.val;
    $(`#v-${v}`).value = b.dataset.val;
    $$(`[data-quick="${v}"]`).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    update();
  });

  function display(v, raw) {
    const f = FIELDS[v] || {};
    const s = String(raw ?? "").trim();
    if (!s) return "";
    if (f.money) return `Ksh ${s}`;
    if (f.type === "date") return new Date(`${s}T12:00:00+03:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
    if (f.type === "time") {
      const [h, m] = s.split(":").map(Number);
      return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
    }
    return s;
  }
  function variables() {
    if (!state.template) return {};
    return Object.fromEntries(varsOf(state.template.body).map(v => [v, display(v, state.raw[v])]));
  }
  function fillBody(html) {
    const vars = variables();
    const body = html ? esc(state.template.body) : state.template.body;
    return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v) => vars[v]
      ? (html ? `<span class="var-filled">${esc(vars[v])}</span>` : vars[v])
      : (html ? `<span class="var-missing">${esc(labelFor(v).toLowerCase())}</span>` : `[${v}]`));
  }

  const todayNairobi = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  $("#sendDate").min = todayNairobi();
  $("#sendDate").value = todayNairobi();
  const whenValue = () => $('input[name="when"]:checked').value;
  $$('input[name="when"]').forEach(r => r.addEventListener("change", () => { $("#laterWrap").hidden = whenValue() !== "later"; update(); }));
  ["#sendDate", "#sendTime"].forEach(s => $(s).addEventListener("input", update));

  function sendAt() {
    if (whenValue() !== "later") return { value: "", label: "now", error: "" };
    const d = $("#sendDate").value, t = $("#sendTime").value;
    if (!d || !t) return { value: "", label: "", error: "Pick a day and time." };
    const at = new Date(`${d}T${t}:00+03:00`);
    if (at <= new Date()) return { value: "", label: "", error: "That time has already passed." };
    const label = at.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
    return { value: `${d}T${t}`, label, at, error: "" };
  }

  function update(showPhoneError) {
    const phoneTyped = $("#phone").value.trim();
    const phoneOk = !!state.phone;
    const phoneBad = phoneTyped && !phoneOk;
    $("#phoneWrap").classList.toggle("invalid", !!(phoneBad && showPhoneError));
    const pm = $("#phoneMsg");
    if (phoneOk) { pm.className = "ok"; pm.innerHTML = `<svg class="icon" style="width:15px;height:15px"><use href="#i-check"/></svg>Will send to ${prettyPhone(state.phone)}`; }
    else if (phoneBad && showPhoneError) { pm.className = "error"; pm.textContent = "That doesn't look like a Kenyan mobile number. Check it has 10 digits, like 0712 345 678."; }
    else { pm.className = "hint"; pm.textContent = "Any format works: 0712…, 254712… or +254 712…"; }

    const t = state.template;
    const vars = variables();
    const missing = t ? varsOf(t.body).filter(v => !vars[v]) : [];
    const when = sendAt();

    $("#step1").classList.toggle("done", phoneOk);
    $("#step2").classList.toggle("done", !!t && !missing.length);
    $("#step3").classList.toggle("done", !when.error);
    $("#whenError").textContent = when.error; $("#whenError").hidden = !when.error;

    $("#phoneField").value = state.phone || "";
    $("#templateField").value = t?.id || "";
    $("#variablesField").value = JSON.stringify(vars);
    $("#sendAtField").value = when.value;
    $("#techOut").textContent = `phone     ${state.phone || "—"}\ntemplate  ${t?.id || "—"}\nvariables ${JSON.stringify(vars, null, 2)}\nsendAt    ${when.value || "(empty = now)"}`;

    const name = vars.name || state.raw.name || "";
    $("#avatar").textContent = name ? name.trim()[0].toUpperCase() : "?";
    $("#chatName").textContent = name || "Customer";
    $("#chatNumber").textContent = phoneOk ? prettyPhone(state.phone) : "No number yet";
    $("#dayPill").textContent = when.at ? when.at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: TZ }) : "Today";
    const timeStr = (when.at || new Date()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
    $("#bubble").innerHTML = t ? `${fillBody(true)}<time>${timeStr}</time>` : "Pick a message to see it here.";
    $("#previewMeta").textContent = !t ? "Highlighted words come from the details you fill in."
      : missing.length ? `Still to fill in: ${missing.map(v => labelFor(v).toLowerCase()).join(", ")}` : "Ready to send.";

    const ready = phoneOk && t && !missing.length && !when.error;
    const later = whenValue() === "later";
    $("#sendBtn").disabled = !ready;
    $("#sendBtn span").textContent = later ? "Schedule message" : "Send message";
    $("#summary").innerHTML = !phoneOk ? "Add the customer's number."
      : !t ? "Pick a message."
      : missing.length ? `Fill in ${esc(missing.map(v => labelFor(v).toLowerCase()).join(", "))}.`
      : when.error ? esc(when.error)
      : `<strong>${esc(nameOf(t.id))}</strong> to <strong>${esc(name || prettyPhone(state.phone))}</strong>${name ? ` (${prettyPhone(state.phone)})` : ""}, ${later ? esc(when.label) : "now"}.`;
  }

  const modal = $("#confirm");
  let lastFocus = null;
  $("#notifyForm").addEventListener("submit", e => {
    e.preventDefault();
    if ($("#sendBtn").disabled) return;
    const when = sendAt(), vars = variables();
    $("#confirmTitle").textContent = whenValue() === "later" ? "Schedule this message?" : "Send this message?";
    $("#cTo").textContent = `${vars.name ? vars.name + " · " : ""}${prettyPhone(state.phone)}`;
    $("#cTpl").textContent = nameOf(state.template.id);
    $("#cWhen").textContent = whenValue() === "later" ? when.label : "Right now";
    $("#cMsg").textContent = fillBody(false);
    $("#cOk span").textContent = whenValue() === "later" ? "Yes, schedule" : "Yes, send";
    lastFocus = document.activeElement;
    modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
    $("#cOk").focus();
  });
  function closeModal() { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); lastFocus?.focus(); }
  $("#cCancel").addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => {
    if (!modal.classList.contains("open")) return;
    if (e.key === "Escape") closeModal();
    if (e.key === "Tab") {
      const f = [$("#cCancel"), $("#cOk")], i = f.indexOf(document.activeElement);
      e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });

  $("#cOk").addEventListener("click", async () => {
    const ok = $("#cOk"); ok.disabled = true; ok.querySelector("span").textContent = "Sending…";
    const entry = {
      id: Math.random().toString(36).slice(2), at: Date.now(), phone: state.phone,
      name: variables().name || "", template: state.template.id,
      scheduled: sendAt().at ? sendAt().at.getTime() : null, status: "queued",
    };
    try {
      if (LIVE) { $("#notifyForm").submit(); return; }
      await new Promise(r => setTimeout(r, 500));
      log.unshift(entry); renderLog();
      closeModal();
      toast(entry.scheduled ? `Scheduled for ${entry.name || "the customer"}` : `Message queued for ${entry.name || "the customer"}`);
      resetForm();
    } catch {
      toast("Couldn't send. Check your connection and try again.");
    } finally {
      ok.disabled = false; ok.querySelector("span").textContent = "Yes, send";
    }
  });

  function resetForm() {
    $("#phone").value = ""; state.phone = null; state.raw = {};
    $$('input[name="when"]')[0].checked = true; $("#laterWrap").hidden = true;
    renderVars(); update();
    $("#phone").focus();
  }

  // ---------- Recent log (from the server; falls back to a sample) ----------
  const now = Date.now();
  let log = Array.isArray(window.NOTIFY_LOG) ? window.NOTIFY_LOG.slice() : [
    { at: now - 25 * 60e3, phone: "254712345678", name: "Wanjiku", template: "out_for_delivery", status: "read" },
    { at: now - 3 * 3600e3, phone: "254722000111", name: "Akinyi", template: "payment_received", status: "delivered" },
  ];
  const STATUS = { queued: "Queued", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed", skipped_optout: "Opted out" };
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  function ago(ts) {
    const s = (ts - Date.now()) / 1000, a = Math.abs(s);
    if (a < 45) return "just now";
    if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
    if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
    return rtf.format(Math.round(s / 86400), "day");
  }
  const pretty = d => d && d.length === 12 ? prettyPhone(d) : String(d || "");
  function renderLog() {
    $("#logEmpty").hidden = log.length > 0;
    $("#log").innerHTML = log.slice(0, 5).map(n => {
      const sched = n.scheduled && n.status === "queued"
        ? `for ${new Date(n.scheduled).toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ })}` : ago(n.at);
      return `<li>
        <span class="who">${esc(n.name ? `${n.name} · ` : "")}${esc(pretty(n.phone))}</span>
        <span class="chip ${esc(n.status)}">${n.scheduled && n.status === "queued" ? "Scheduled" : esc(STATUS[n.status] || n.status)}</span>
        <span class="what">${esc(nameOf(n.template))} · ${esc(sched)}</span>
      </li>`;
    }).join("");
  }
  setInterval(renderLog, 60e3);

  let tt;
  function toast(msg) {
    const t = $("#toast"); t.querySelector("span").textContent = msg; t.classList.add("show");
    clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2800);
  }

  const sidebar = $("#sidebar"), menuBtn = $("#menuBtn");
  menuBtn.addEventListener("click", () => { const o = sidebar.classList.toggle("open"); menuBtn.setAttribute("aria-expanded", String(o)); });
  document.addEventListener("click", e => {
    if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) { sidebar.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); }
  });

  // Prefill from a link (e.g. "Message" on the Contacts page, "Send with this" on Templates).
  const q = new URLSearchParams(location.search);
  if (q.get("phone")) { $("#phone").value = q.get("phone"); state.phone = normalisePhone(q.get("phone")); }
  if (q.get("template")) {
    const t = TEMPLATES.find(x => x.id === q.get("template"));
    if (t) { varsOf(t.body).forEach(v => { const val = q.get(v); if (val) state.raw[v] = FIELDS[v]?.money && /^\d+$/.test(val) ? Number(val).toLocaleString("en-KE") : val; }); selectTemplate(t.id, false); }
  }

  renderLog();
  update();
  // A send/error from the server reloads the page — show it as a toast.
  if (window.NOTIFY_FLASH && window.NOTIFY_FLASH.text) toast(window.NOTIFY_FLASH.text);
}
