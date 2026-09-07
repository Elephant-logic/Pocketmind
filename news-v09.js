(() => {
  const VERSION = "PWA v0.9 SERVER NEWS";
  let busy = false;
  let bypass = false;
  const $ = id => document.getElementById(id);

  function isNewsQuery(q) {
    return /\b(news|headlines|breaking|latest news|current news|recent news|what(?:'s| is) happening)\b/i.test(q || "");
  }

  function categoryFor(q) {
    const s = String(q || "");
    if (/\b(uk|u\.k\.|united kingdom|britain|british|england|scotland|wales|northern ireland)\b/i.test(s)) return "uk";
    if (/\b(world|global|international)\b/i.test(s)) return "world";
    return "search";
  }

  function searchTerms(q) {
    const stop = new Set(["what","whats","what's","is","are","the","a","an","latest","current","recent","news","headlines","breaking","happening","in","on","about","from","today","now","please","tell","me"]);
    return String(q || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(x => x.length > 1 && !stop.has(x));
  }

  function ageText(iso) {
    const ms = Date.now() - Date.parse(iso || "");
    if (!Number.isFinite(ms)) return "update time unknown";
    const min = Math.max(0, Math.round(ms / 60000));
    if (min < 2) return "updated just now";
    if (min < 60) return `updated ${min} minutes ago`;
    const h = Math.round(min / 60);
    return `updated about ${h} hour${h === 1 ? "" : "s"} ago`;
  }

  async function loadSnapshot() {
    const r = await fetch(`./news.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`news.json HTTP ${r.status}`);
    const data = await r.json();
    if (!data?.categories) throw new Error("news.json is invalid");
    return data;
  }

  function selectItems(q, data) {
    const category = categoryFor(q);
    let pool;
    let label;
    if (category === "uk") {
      pool = data.categories.uk || [];
      label = "UK";
    } else if (category === "world") {
      pool = data.categories.world || [];
      label = "World";
    } else {
      pool = [...(data.categories.uk || []), ...(data.categories.world || [])];
      const terms = searchTerms(q);
      if (terms.length) {
        const filtered = pool.filter(item => {
          const hay = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
          return terms.some(t => hay.includes(t));
        });
        if (filtered.length) pool = filtered;
      }
      label = terms.length ? terms.join(" ") : "Latest";
    }

    pool = [...pool].sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));

    const chosen = [];
    const usedSources = new Set();
    for (const item of pool) {
      if (chosen.length >= 5) break;
      if (!usedSources.has(item.source)) {
        chosen.push(item);
        usedSources.add(item.source);
      }
    }
    for (const item of pool) {
      if (chosen.length >= 5) break;
      if (!chosen.includes(item)) chosen.push(item);
    }
    return { label, items: chosen };
  }

  function addMessage(role, text = "") {
    const chat = $("chat");
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = role === "user" ? "You" : "PocketMind";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    wrap.append(who, bubble);
    chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
    return bubble;
  }

  function renderResults(q, data) {
    const selected = selectItems(q, data);
    const bubble = addMessage("assistant", "");

    const heading = document.createElement("div");
    heading.style.fontWeight = "700";
    heading.textContent = `Latest source headlines — ${selected.label}`;
    bubble.appendChild(heading);

    const note = document.createElement("div");
    note.style.fontSize = "12px";
    note.style.color = "var(--muted)";
    note.style.margin = "5px 0 12px";
    note.textContent = `Fetched server-side from RSS · ${ageText(data.generatedAt)}.`;
    bubble.appendChild(note);

    if (!selected.items.length) {
      const none = document.createElement("div");
      none.textContent = "The server snapshot has no matching headlines right now.";
      bubble.appendChild(none);
      return bubble;
    }

    selected.items.forEach((item, i) => {
      const row = document.createElement("div");
      row.style.padding = "10px 0";
      row.style.borderTop = i ? "1px solid var(--border)" : "0";

      const a = document.createElement("a");
      a.href = item.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.color = "#58a6ff";
      a.style.textDecoration = "none";
      a.style.fontWeight = "600";
      a.textContent = `${i + 1}. ${item.title}`;

      const meta = document.createElement("div");
      meta.style.fontSize = "11px";
      meta.style.color = "var(--muted)";
      meta.style.marginTop = "3px";
      const when = item.publishedAt ? new Date(item.publishedAt).toLocaleString() : "time unknown";
      meta.textContent = `${item.source} · ${when}`;
      row.append(a, meta);
      bubble.appendChild(row);
    });

    const controls = document.createElement("div");
    controls.style.marginTop = "14px";
    controls.style.display = "flex";
    controls.style.gap = "8px";
    controls.style.flexWrap = "wrap";

    const summarize = document.createElement("button");
    summarize.className = "primary";
    summarize.textContent = "Summarise locally";
    summarize.addEventListener("click", () => summarizeLocally(selected.items, summarize));

    const refresh = document.createElement("button");
    refresh.textContent = "Refresh headlines";
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      refresh.textContent = "Refreshing…";
      try {
        const fresh = await loadSnapshot();
        const b = renderResults(q, fresh);
        b?.scrollIntoView({ behavior: "smooth", block: "end" });
      } catch (e) {
        addMessage("assistant", "The server news snapshot could not be refreshed: " + (e?.message || e));
      } finally {
        refresh.disabled = false;
        refresh.textContent = "Refresh headlines";
      }
    });

    controls.append(summarize, refresh);
    bubble.appendChild(controls);
    return bubble;
  }

  function summarizeLocally(items, button) {
    const input = $("input");
    const send = $("send");
    const mode = $("researchMode");
    if (!input || !send || !items.length) return;

    const compact = items.map((x, i) => `${i + 1}. ${x.title} — ${x.source}${x.summary ? ` — ${x.summary}` : ""}`).join("\n");
    const prompt = `Summarise these current news items in 3-5 short bullets. Use only the supplied headlines and summaries. Do not invent facts. Mention when stories are unrelated or evidence is limited.\n\n${compact}`;
    const previousMode = mode?.value;
    if (mode) mode.value = "never";
    input.value = prompt;
    bypass = true;
    button.disabled = true;
    button.textContent = "Summarising…";
    try {
      send.click();
      const users = document.querySelectorAll(".msg.user .bubble");
      const last = users[users.length - 1];
      if (last) last.textContent = "Summarise these source headlines";
    } finally {
      bypass = false;
      if (mode && previousMode != null) mode.value = previousMode;
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "Summarise locally";
      }, 1200);
    }
  }

  async function handleNews(q) {
    if (busy) return;
    busy = true;
    const input = $("input");
    if (input) input.value = "";
    addMessage("user", q);
    const bubble = addMessage("assistant", "Loading server-fetched headlines…");
    try {
      const data = await loadSnapshot();
      bubble.parentElement?.remove();
      renderResults(q, data);
    } catch (e) {
      bubble.textContent = "The same-origin server news snapshot is unavailable right now: " + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  function shouldIntercept(q) {
    if (bypass || busy || !isNewsQuery(q)) return false;
    const mode = $("researchMode");
    return mode?.value !== "never";
  }

  document.addEventListener("click", e => {
    const btn = e.target?.closest?.("#send");
    if (!btn) return;
    const q = $("input")?.value?.trim() || "";
    if (!shouldIntercept(q)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    handleNews(q);
  }, true);

  document.addEventListener("keydown", e => {
    if (e.target?.id !== "input" || e.key !== "Enter" || e.shiftKey) return;
    const q = e.target.value.trim();
    if (!shouldIntercept(q)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    handleNews(q);
  }, true);

  window.addEventListener("DOMContentLoaded", () => {
    const badge = document.querySelector(".badge");
    if (badge) badge.textContent = VERSION;
  });
})();
