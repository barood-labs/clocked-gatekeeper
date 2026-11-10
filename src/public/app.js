const STR = {
  en: {
    product: "Gatekeeper",
    tagline: "A safety airlock in front of your assistant.",
    eyebrow: "Built for the Clocked Build Challenge 2026",
    intake: "Intake",
    kind: "What is this?",
    samples: "Samples",
    message: "Message",
    email: "Email",
    retrieved: "Retrieved page",
    script: "Script",
    placeholder: "Paste a message, an email, a retrieved page, or a script.",
    screen: "Screen",
    screening: "Screening…",
    runAll: "Screen all samples",
    audit: "Audit log",
    clear: "Clear",
    emptyAudit: "No decisions yet.",
    pass: "Pass",
    quarantine: "Quarantine",
    ask: "Ask a human",
    emptyTitle: "Screen it before the assistant sees it.",
    emptyBody: "Gatekeeper runs Clocked Protect, Guard, and Inspect, then changes what happens next.",
    empty1: "Pass releases the masked copy.",
    empty2: "Quarantine holds an injection or a risky script and marks the evidence.",
    empty3: "Ask a human when a probability sits in the uncertain band, or a check comes back incomplete.",
    protect: "Protect",
    guard: "Guard",
    inspect: "Inspect",
    source: "Source",
    payload: "What the assistant receives",
    held: "Nothing is released.",
    proposed: "Proposed mask. It stays here until a person releases it.",
    copy: "Copy",
    copied: "Copied",
    pii: "Personal data",
    injection: "Injection",
    scriptLine: "Risky line",
    notRun: "Not run on prose.",
    attempts: "attempts",
    credits: "credits",
    live: "Live",
    fixture: "Fixture",
    recorded: "Replaying a recorded Clocked response for this sample.",
    standin: "Offline stand-in. This is not a Clocked model read.",
    drill: "Resilience drill. Nothing was sent to Clocked.",
    drillsSummary: "Resilience drill",
    drillsOn: "These failures are simulated in the browser's server. No Clocked credit is spent.",
    drillsOff: "Drills stay off while the live key is set, so a click cannot spend credits.",
    chars: "characters",
    via: "via /pipeline",
    loading: "Reading with Clocked…",
    fault: "The screen did not finish.",
  },
  ar: {
    product: "حارس البوابة",
    tagline: "غرفة عزل أمام المساعد قبل أن يصل إليه النص.",
    eyebrow: "صُنع لتحدي Clocked للبناء 2026",
    intake: "الوارد",
    kind: "ما هذا؟",
    samples: "عيّنات",
    message: "رسالة",
    email: "بريد",
    retrieved: "صفحة مسترجعة",
    script: "نص برمجي",
    placeholder: "ألصق رسالة أو بريداً أو صفحة مسترجعة أو نصاً برمجياً.",
    screen: "افحص",
    screening: "جارٍ الفحص…",
    runAll: "افحص كل العيّنات",
    audit: "سجل التدقيق",
    clear: "مسح",
    emptyAudit: "لا قرارات بعد.",
    pass: "سماح",
    quarantine: "حجر",
    ask: "اسأل إنساناً",
    emptyTitle: "افحص النص قبل أن يراه المساعد.",
    emptyBody: "يشغّل حارس البوابة حماية Clocked وحراستها وتفتيشها، ثم يغيّر ما يحدث بعد ذلك.",
    empty1: "السماح يمرّر النسخة المقنّعة.",
    empty2: "الحجر يحبس الحقن أو النص الخطِر ويعلّم الدليل.",
    empty3: "اسأل إنساناً حين يقع الاحتمال في المنطقة غير المحسومة، أو حين يرجع فحص ناقصاً.",
    protect: "حماية",
    guard: "حراسة",
    inspect: "تفتيش",
    source: "المصدر",
    payload: "ما يصل إلى المساعد",
    held: "لا يُرسَل شيء.",
    proposed: "قناع مقترح. يبقى هنا حتى يفرج عنه إنسان.",
    copy: "انسخ",
    copied: "نُسخ",
    pii: "بيانات شخصية",
    injection: "حقن",
    scriptLine: "سطر خطِر",
    notRun: "لا يعمل على النثر.",
    attempts: "محاولات",
    credits: "رصيد",
    live: "مباشر",
    fixture: "تسجيل",
    recorded: "إعادة تشغيل استجابة Clocked مسجّلة لهذه العيّنة.",
    standin: "بديل محلي. هذه ليست قراءة من نموذج Clocked.",
    drill: "تدريب على العطل. لم يُرسَل شيء إلى Clocked.",
    drillsSummary: "تدريب على العطل",
    drillsOn: "هذه الأعطال تُحاكى داخل الخادم. لا يُصرف رصيد Clocked.",
    drillsOff: "التدريب متوقف حين يكون المفتاح المباشر مضبوطاً، حتى لا تُصرف أرصدة بالخطأ.",
    chars: "حرفاً",
    via: "عبر /pipeline",
    loading: "القراءة عبر Clocked جارية…",
    fault: "لم يكتمل الفحص.",
  },
};

const state = {
  lang: localStorage.getItem("gk-lang") || "en",
  kind: "email",
  samples: [],
  health: null,
  busy: false,
  activeSample: null,
};

const $ = (id) => document.getElementById(id);
const t = () => STR[state.lang] || STR.en;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function fmt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const two = value.toFixed(2);
  if ((two === "1.00" && value < 1) || (two === "0.00" && value > 0)) return value.toFixed(3);
  return two;
}

function fmtBand(band) {
  if (!Array.isArray(band) || band.length < 2) return "0.35–0.65";
  return `${Number(band[0]).toFixed(2)}–${Number(band[1]).toFixed(2)}`;
}

function applyLang() {
  const s = t();
  document.documentElement.lang = state.lang === "ar" ? "ar" : "en";
  document.documentElement.dir = state.lang === "ar" ? "rtl" : "ltr";
  document.title = s.product;
  $("product").textContent = s.product;
  $("tagline").textContent = s.tagline;
  $("eyebrow").textContent = s.eyebrow;
  $("intake-title").textContent = s.intake;
  $("kind-label").textContent = s.kind;
  $("samples-label").textContent = s.samples;
  $("text").placeholder = s.placeholder;
  $("screen").textContent = state.busy ? s.screening : s.screen;
  $("run-all").textContent = s.runAll;
  $("audit-title").textContent = s.audit;
  $("clear-audit").textContent = s.clear;
  $("drills-summary").textContent = s.drillsSummary;
  const live = state.health?.mode === "live";
  $("drills-copy").textContent = live ? s.drillsOff : s.drillsOn;
  document.querySelectorAll("[data-drill]").forEach((button) => {
    button.disabled = live || state.busy;
  });
  document.querySelectorAll("[data-lang]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lang === state.lang));
  });
  renderKinds();
  renderSamples();
  renderCount();
  const stage = $("stage");
  if (stage.dataset.state === "empty") renderEmpty();
  if (stage._result) renderResult(stage._result);
}

function renderMode() {
  const s = t();
  const mode = state.health?.mode || "fixture";
  const node = $("mode");
  node.dataset.mode = mode;
  node.textContent = mode === "live" ? s.live : s.fixture;
}

function renderKinds() {
  const s = t();
  const kinds = [
    ["message", s.message],
    ["email", s.email],
    ["retrieved", s.retrieved],
    ["script", s.script],
  ];
  $("kinds").innerHTML = kinds
    .map(
      ([id, label]) =>
        `<button type="button" role="radio" data-kind="${id}" aria-checked="${state.kind === id}">${escapeHtml(label)}</button>`,
    )
    .join("");
}

function renderSamples() {
  const lang = state.lang === "ar" ? "ar" : "en";
  $("samples").innerHTML = state.samples
    .map((sample) => {
      const title = sample.title?.[lang] || sample.title?.en || sample.id;
      return `<button type="button" data-sample="${escapeHtml(sample.id)}" aria-pressed="${state.activeSample === sample.id}">${escapeHtml(title)}</button>`;
    })
    .join("");
}

function renderCount() {
  const chars = Array.from($("text").value).length;
  const limit = state.health?.textLimit || 60000;
  $("count").textContent = `${chars.toLocaleString(state.lang === "ar" ? "ar" : "en")} / ${limit.toLocaleString(state.lang === "ar" ? "ar" : "en")}`;
}

function renderEmpty() {
  const s = t();
  const stage = $("stage");
  stage.dataset.state = "empty";
  stage._result = null;
  stage.innerHTML = `<div class="empty"><h2>${escapeHtml(s.emptyTitle)}</h2><p>${escapeHtml(s.emptyBody)}</p><ol><li>${escapeHtml(s.empty1)}</li><li>${escapeHtml(s.empty2)}</li><li>${escapeHtml(s.empty3)}</li></ol></div>`;
}

function renderLoading() {
  const stage = $("stage");
  stage.dataset.state = "loading";
  stage.innerHTML = `<div class="empty"><h2>${escapeHtml(t().loading)}</h2></div>`;
}

function renderFault(message) {
  const stage = $("stage");
  stage.dataset.state = "fault";
  stage._result = null;
  stage.innerHTML = `<div class="fault"><h2>${escapeHtml(t().fault)}</h2><p>${escapeHtml(message || "")}</p></div>`;
}

function explainProtect(check, decision) {
  const ar = state.lang === "ar";
  const types = (check.types || []).join(ar ? "، " : ", ");
  if (check.code === "clean") {
    if (decision === "pass") return ar ? "لم تجد الحماية بيانات شخصية. يمكن إرسال النص الأصلي." : "Protect found no personal data. The original text can be released.";
    return ar ? "لم تجد الحماية بيانات شخصية." : "Protect found no personal data.";
  }
  if (check.code === "masked") {
    if (decision === "pass") return ar ? `وجدت الحماية ${check.count} مقطعاً (${types}). النص المُرسَل هو النسخة المقنّعة.` : `Protect found ${check.count} spans (${types}). The released text is the masked copy.`;
    return ar ? `وجدت الحماية ${check.count} مقطعاً (${types}). القناع جاهز، وهو غير مُرسَل.` : `Protect found ${check.count} spans (${types}). The mask is ready, and it is not released.`;
  }
  if (check.code === "uncertain-span") return ar ? `وجدت الحماية ${check.count} مقطعاً (${types})، وبعضها يحتاج تأكيد إنسان قبل الإرسال.` : `Protect found ${check.count} spans (${types}), and some need a person to confirm the mask.`;
  if (check.code === "missing-mask") return ar ? "وجدت الحماية بيانات شخصية ولم تُرجع نسخة مقنّعة مختلفة. لا يُرسَل شيء." : "Protect found personal data but no distinct masked copy. Nothing is released.";
  if (check.code === "failed") return ar ? "لم تُجب الحماية. لا يُرسَل النص الخام." : "Protect did not answer. The raw text is not released.";
  return check.detail;
}

function explainGuard(check) {
  const ar = state.lang === "ar";
  const p = fmt(check.probability);
  const band = fmtBand(check.band);
  if (check.code === "failed") return ar ? "لم تُجب الحراسة. لا يمكن إخلاء النص." : "Guard did not answer. The text cannot be cleared.";
  if (check.code === "missing") return ar ? "احتمال الحراسة غير موجود. لا يمكن إخلاء النص." : "Guard probability was missing. The text cannot be cleared.";
  if (check.code === "borderline") return ar ? `احتمال الحقن ${p} داخل المنطقة غير المحسومة (${band}). القرار لإنسان.` : `Guard injection probability ${p} is inside the uncertain band (${band}). A person makes this call.`;
  if (check.code === "injection") {
    const extra = [check.verdict, check.category, check.severity].filter(Boolean).join(ar ? "، " : ", ");
    return ar ? `احتمال الحقن ${p}${extra ? `، ${extra}` : ""}. النص محبوس.` : `Guard injection probability ${p}${extra ? `, ${extra}` : ""}. The text is held.`;
  }
  if (check.code === "conflict" || check.code === "unclear") return ar ? `الحكم ${check.verdict || "—"} والاحتمال ${p} لا يتفقان. القرار لإنسان.` : `Guard verdict ${check.verdict || "missing"} and probability ${p} disagree. A person makes this call.`;
  return ar ? `احتمال الحقن ${p} تحت المنطقة غير المحسومة (${band}). الحكم: ${check.verdict || "benign"}.` : `Guard injection probability ${p} is below the uncertain band (${band}). Verdict: ${check.verdict || "benign"}.`;
}

function explainInspect(check) {
  const ar = state.lang === "ar";
  if (check.outcome === "skip") return ar ? "التفتيش لا يعمل على هذا الوارد. النصوص البرمجية فقط تُفتَّش." : "Inspect does not run on this intake. Only scripts are inspected.";
  const p = fmt(check.probability);
  const band = fmtBand(check.band);
  const numbers = ar ? `ضار ${fmt(check.malicious)}، مريب ${fmt(check.suspicious)}` : `malicious ${fmt(check.malicious)}, suspicious ${fmt(check.suspicious)}`;
  if (check.code === "failed") return ar ? "لم يُجب التفتيش. لا يُخلَّى نص برمجي من دونه." : "Inspect did not answer. A script cannot be cleared without it.";
  if (check.code === "missing") return ar ? "احتمال التفتيش غير موجود. لا يُخلَّى النص." : "Inspect probability was missing. A script cannot be cleared.";
  if (check.code === "borderline") return ar ? `احتمال ${check.drivenBy || "الخطر"} ${p} داخل المنطقة غير المحسومة (${band}). القرار لإنسان.` : `Inspect ${check.drivenBy || "risk"} probability ${p} is inside the uncertain band (${band}). A person makes this call.`;
  if (check.code === "risky-script") {
    const extra = [check.verdict, check.category, check.severity].filter(Boolean).join(ar ? "، " : ", ");
    return ar ? `التفتيش ${numbers}${extra ? `، ${extra}` : ""}. النص محبوس.` : `Inspect ${numbers}${extra ? `, ${extra}` : ""}. The script is held.`;
  }
  if (check.code === "conflict" || check.code === "unclear") return ar ? `الحكم ${check.verdict || "—"} والاحتمال ${p} لا يتفقان. القرار لإنسان.` : `Inspect verdict ${check.verdict || "missing"} and probability ${p} disagree. A person makes this call.`;
  return ar ? `التفتيش ${numbers}. ${p} تحت المنطقة غير المحسومة (${band}). الحكم: ${check.verdict || "benign"}.` : `Inspect ${numbers}. ${p} is below the uncertain band (${band}). Verdict: ${check.verdict || "benign"}.`;
}

function summaryFor(result) {
  const s = t();
  if (result.error && state.lang !== "ar") return result.summary;
  if (result.error && state.lang === "ar") return `${s.ask}. ${result.summary}`;
  if (result.decision === "pass" && result.forwardLabel === "masked") return state.lang === "ar" ? "سماح. يصل المساعد إلى النسخة المقنّعة." : "Pass. The assistant receives the masked copy.";
  if (result.decision === "pass") return state.lang === "ar" ? "سماح. يصل المساعد إلى النص الأصلي." : "Pass. The assistant receives the original text.";
  if (result.decision === "quarantine") return state.lang === "ar" ? "حجر. لا يُرسَل شيء." : "Quarantine. Nothing is released.";
  return state.lang === "ar" ? "اسأل إنساناً. لا يُرسَل شيء." : "Ask a human. Nothing is released.";
}

function meter(probability, band) {
  if (typeof probability !== "number") return "";
  const [low, high] = Array.isArray(band) && band.length === 2 ? band : [0.35, 0.65];
  const left = Math.max(0, Math.min(100, low * 100));
  const width = Math.max(0, Math.min(100 - left, (high - low) * 100));
  const needle = Math.max(0, Math.min(100, probability * 100));
  return `<div class="meter" aria-hidden="true"><div class="meter-band" style="left:${left}%;width:${width}%"></div><div class="meter-needle" style="left:${needle}%"></div></div>`;
}

function bars(categories) {
  const entries = Object.entries(categories || {}).filter(([, value]) => typeof value === "number").sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!entries.length) return "";
  return `<div class="bars">${entries
    .map(([name, value]) => {
      const width = Math.max(2, Math.round(value * 100));
      return `<div class="bar"><span class="bar-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="bar-track"><span style="width:${width}%"></span></span><span>${fmt(value)}</span></div>`;
    })
    .join("")}</div>`;
}

function highlighted(text, highlights, direction) {
  const chars = Array.from(text);
  const usable = (highlights || []).filter((item) => item.aligned && Number.isInteger(item.start) && Number.isInteger(item.end) && item.end > item.start && item.end <= chars.length);
  const points = new Set([0, chars.length]);
  for (const item of usable) {
    points.add(item.start);
    points.add(item.end);
  }
  const bounds = [...points].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const tags = usable.filter((item) => item.start <= start && item.end >= end);
    const body = escapeHtml(chars.slice(start, end).join(""));
    if (!tags.length) {
      html += body;
      continue;
    }
    const cls = [...new Set(tags.map((tag) => `mark-${tag.channel}`))].join(" ");
    const title = [...new Set(tags.map((tag) => tag.label))].join(", ");
    html += `<mark class="${cls}" title="${escapeHtml(title)}">${body}</mark>`;
  }
  return `<pre dir="${direction === "rtl" ? "rtl" : "ltr"}">${html}</pre>`;
}

function assessmentNote(result) {
  const s = t();
  if (result.assessment === "recorded-fixture") return s.recorded;
  if (result.assessment === "offline-stand-in") return s.standin;
  if (result.assessment === "drill") return s.drill;
  return "";
}

function renderResult(result) {
  const s = t();
  const stage = $("stage");
  stage.dataset.state = "ready";
  stage._result = result;
  const decision = result.decision === "quarantine" ? "quarantine" : result.decision === "ask" ? "ask" : "pass";
  const word = decision === "pass" ? s.pass : decision === "quarantine" ? s.quarantine : s.ask;
  const note = assessmentNote(result);
  const usage = [
    result.model,
    `${result.attempts} ${s.attempts}`,
    result.usage?.credits ? `${result.usage.credits} ${s.credits}` : "",
    result.usage?.transport || "",
  ].filter(Boolean).join(" · ");
  const protect = result.checks.protect;
  const guard = result.checks.guard;
  const inspect = result.checks.inspect;
  const entityChips = (protect.entities || [])
    .slice(0, 12)
    .map((entity) => `<span class="chip">${escapeHtml(entity.type)} ${fmt(entity.confidence)}</span>`)
    .join("");
  const quoted = (items, channel) =>
    (items || [])
      .filter((item) => {
        const mark = (result.highlights || []).find((highlight) => highlight.channel === channel && highlight.quote === item.quote);
        return !mark?.aligned;
      })
      .map((item) => `<li>${escapeHtml(item.quote)}</li>`)
      .join("");
  const guardQuotes = quoted(guard.evidence, "injection");
  const scriptQuotes = quoted(inspect.evidence, "script");
  const payloadBody = result.forwardText != null
    ? highlighted(result.forwardText, [], result.direction)
    : result.proposedText
      ? `<p class="held">${escapeHtml(s.proposed)}</p>${highlighted(result.proposedText, [], result.direction)}`
      : `<p class="held">${escapeHtml(s.held)}</p>`;
  stage.innerHTML = `
    <div class="banner" data-decision="${decision}">
      <div>
        <p class="kicker">${escapeHtml(result.kind)} · ${escapeHtml(result.mode)}</p>
        <h2 data-decision="${decision}">${escapeHtml(word)}</h2>
        <p class="summary">${escapeHtml(summaryFor(result))}</p>
      </div>
      <p class="meta">${escapeHtml(usage)}</p>
    </div>
    ${note ? `<p class="note">${escapeHtml(note)}</p>` : ""}
    <div class="checks">
      <article class="check" data-outcome="${escapeHtml(protect.outcome)}">
        <header><h3>${escapeHtml(s.protect)}</h3><p class="endpoint">POST /pii ${escapeHtml(s.via)}</p></header>
        ${meter(null)}
        <p>${escapeHtml(explainProtect(protect, decision))}</p>
        <div class="chips">${entityChips}</div>
      </article>
      <article class="check" data-outcome="${escapeHtml(guard.outcome)}">
        <header><h3>${escapeHtml(s.guard)}</h3><p class="endpoint">POST /injection ${escapeHtml(s.via)}</p></header>
        ${meter(guard.probability, guard.band)}
        <p>${escapeHtml(explainGuard(guard))}</p>
        ${bars(guard.categories)}
        ${guardQuotes ? `<ul class="quotes">${guardQuotes}</ul>` : ""}
      </article>
      <article class="check" data-outcome="${escapeHtml(inspect.outcome)}">
        <header><h3>${escapeHtml(s.inspect)}</h3><p class="endpoint">POST /script ${escapeHtml(s.via)}</p></header>
        ${inspect.outcome === "skip" ? "" : meter(inspect.probability, inspect.band)}
        <p>${escapeHtml(explainInspect(inspect))}</p>
        ${bars(inspect.categories)}
        ${scriptQuotes ? `<ul class="quotes">${scriptQuotes}</ul>` : ""}
      </article>
    </div>
    <div class="split">
      <article class="pane">
        <header>
          <h2>${escapeHtml(s.source)}</h2>
          <div class="legend"><span><i class="pii"></i>${escapeHtml(s.pii)}</span><span><i class="injection"></i>${escapeHtml(s.injection)}</span><span><i class="script"></i>${escapeHtml(s.scriptLine)}</span></div>
        </header>
        ${highlighted(result.text || "", result.highlights, result.direction)}
      </article>
      <article class="pane">
        <header>
          <h2>${escapeHtml(s.payload)}</h2>
          ${result.forwardText != null ? `<button type="button" class="copy" id="copy">${escapeHtml(s.copy)}</button>` : ""}
        </header>
        ${payloadBody}
      </article>
    </div>`;
  const copy = $("copy");
  if (copy) {
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(result.forwardText);
        copy.textContent = s.copied;
      } catch {
        copy.textContent = s.copy;
      }
    });
  }
  stage.querySelector(".split mark")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderAudit(entries) {
  const s = t();
  const list = $("audit");
  if (!entries?.length) {
    list.innerHTML = `<li><span class="held">${escapeHtml(s.emptyAudit)}</span></li>`;
    return;
  }
  const lang = state.lang === "ar" ? "ar" : "en";
  list.innerHTML = entries
    .slice(0, 8)
    .map((entry) => {
      const sample = state.samples.find((item) => item.id === entry.sampleId);
      const label = sample?.title?.[lang] || entry.kind;
      const word = entry.decision === "pass" ? s.pass : entry.decision === "quarantine" ? s.quarantine : s.ask;
      return `<li><span class="pill ${escapeHtml(entry.decision)}">${escapeHtml(word)}</span><span>${escapeHtml(label)}</span></li>`;
    })
    .join("");
}

async function loadAudit() {
  const response = await fetch("/api/audit");
  const body = await response.json();
  renderAudit(body.entries || []);
}

async function screenCurrent(drill) {
  const s = t();
  state.busy = true;
  $("screen").disabled = true;
  $("run-all").disabled = true;
  $("screen").textContent = s.screening;
  renderLoading();
  try {
    const response = await fetch("/api/screen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: $("text").value, kind: state.kind, drill: drill || undefined }),
    });
    const body = await response.json();
    if (!response.ok) {
      renderFault(body.error || s.fault);
      return;
    }
    renderResult(body);
    await loadAudit();
  } catch (error) {
    renderFault(error.message);
  } finally {
    state.busy = false;
    $("screen").disabled = false;
    $("run-all").disabled = false;
    applyLang();
    if ($("stage")._result) renderResult($("stage")._result);
  }
}

async function screenAll() {
  for (const sample of state.samples) {
    state.kind = sample.kind;
    state.activeSample = sample.id;
    $("text").value = sample.text;
    renderKinds();
    renderSamples();
    renderCount();
    await screenCurrent();
  }
}

async function boot() {
  const [health, samples] = await Promise.all([
    fetch("/api/health").then((res) => res.json()),
    fetch("/api/samples").then((res) => res.json()),
  ]);
  state.health = health;
  state.samples = samples.samples || [];
  renderMode();
  applyLang();
  renderEmpty();
  await loadAudit();
}

document.addEventListener("click", (event) => {
  const kind = event.target.closest?.("[data-kind]");
  if (kind) {
    state.kind = kind.dataset.kind;
    state.activeSample = null;
    renderKinds();
    renderSamples();
    return;
  }
  const sampleButton = event.target.closest?.("[data-sample]");
  if (sampleButton) {
    const sample = state.samples.find((item) => item.id === sampleButton.dataset.sample);
    if (!sample) return;
    state.kind = sample.kind;
    state.activeSample = sample.id;
    $("text").value = sample.text;
    renderKinds();
    renderSamples();
    renderCount();
    return;
  }
  const lang = event.target.closest?.("[data-lang]");
  if (lang) {
    state.lang = lang.dataset.lang;
    localStorage.setItem("gk-lang", state.lang);
    applyLang();
    return;
  }
  const drill = event.target.closest?.("[data-drill]");
  if (drill && !drill.disabled) {
    if (!$("text").value.trim()) $("text").value = "Drill text with no personal data.";
    screenCurrent(drill.dataset.drill);
  }
});

$("screen").addEventListener("click", () => screenCurrent());
$("run-all").addEventListener("click", () => screenAll());
$("clear-audit").addEventListener("click", async () => {
  await fetch("/api/audit", { method: "DELETE" });
  await loadAudit();
});
$("text").addEventListener("input", () => {
  state.activeSample = null;
  renderSamples();
  renderCount();
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    screenCurrent();
  }
});

boot().catch((error) => renderFault(error.message));
