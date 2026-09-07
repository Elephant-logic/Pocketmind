(() => {
  const VERSION = "PWA v0.8 NEWS";
  let busy = false;
  let bypass = false;

  const $ = id => document.getElementById(id);

  function isNewsQuery(q) {
    return /\b(news|headlines|breaking|what(?:'s| is) happening)\b/i.test(q || "");
  }

  function alias(s) {
    return String(s || "")
      .replace(/\bthe\s+u\.?k\.?\b/gi, "United Kingdom")
      .replace(/\bu\.?k\.?\b/gi, "United Kingdom")
      .replace(/\busa\b/gi, "United States");
  }

  function topicFrom(q) {
    let x = String(q || "").trim().replace(/[?!.]+$/, "");
    x = x.replace(/^what(?:'s| is)?\s+(?:the\s+)?(?:latest\s+)?(?:news|headlines)(?:\s+(?:about|on|in|from))?\s*/i, "");
    x = x.replace(/^what\s+news(?:\s+(?:about|on|in|from))?\s*/i, "");
    x = x.replace(/^what(?:'s| is)\s+happening(?:\s+(?:about|on|in|with))?\s*/i, "");
    x = x.replace(/^(?:latest|current|recent|breaking)\s+(?:news|headlines)(?:\s+(?:about|on|in|from))?\s*/i, "");
    x = alias(x).trim();
    return x || "world";
  }

  function gdeltQuery(topic) {
    if (/United Kingdom/i.test(topic)) return '(Britain OR British OR "United Kingdom") sourcelang:English';
    if (/United States/i.test(topic)) return '(USA OR American OR "United States") sourcelang:English';
    if (/^world$/i.test(topic)) return '(world OR global) sourcelang:English';
    return `"${topic.replace(/"/g, "")}" sourcelang:English`;
  }

  function seenDate(raw) {
    if (!raw || raw.length < 8) return "";
    const y = raw.slice(0,4), m = raw.slice(4,6), d = raw.slice(6,8);
    const hh = raw.slice(9,11), mm = raw.slice(11,13);
    return `${y}-${m}-${d}${hh ? ` ${hh}:${mm} UTC` : ""}`;
  }

  async function fetchJSON(url, timeout = 15000) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    try {
      const r = await fetch(url, { cache: "no-store", signal: c.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function searchNews(q) {
    const topic = topicFrom(q);
    const endpoint = "https://api.gdeltproject.org/api/v2/doc/doc";

    async function run(span) {
      const p = new URLSearchParams({
        query: gdeltQuery(topic),
        mode: "ArtList",
        format: "json",
        maxrecords: "18",
        sort: "DateDesc",
        timespan: span
      });
      return fetchJSON(endpoint + "?" + p.toString());
    }

    let data = await run("24h");
    let articles = Array.isArray(data?.articles) ? data.articles : [];
    if (articles.length < 3) {
      try {
        data = await run("3d");
        articles = Array.isArray(data?.articles) ? data.articles : articles;
      } catch (_) {}
    }

    const domains = new Set();
    const items = [];
    for (const a of articles) {
      if (!a?.url || !a?.title) continue;
      let domain = String(a.domain || "").toLowerCase();
      if (!domain) {
        try { domain = new URL(a.url).hostname.replace(/^www\./, ""); }
        catch (_) { domain = "source"; }
      }
      if (domains.has(domain)) continue;
      domains.add(domain);
      items.push({
        title: a.title,
        url: a.url,
        domain,
        date: seenDate(a.seendate)
      });
      if (items.length >= 5) break;
    }
    if (!items.length) throw new Error("No live headlines were returned");
    return { topic, items };
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

  function renderResults(q, result) {
    const bubble = addMessage("assistant", "");

    const heading = document.createElement("div");
    heading.style.fontWeight = "700";
    heading.style.marginBottom = "6px";
    heading.textContent = `Current source headlines — ${result.topic}`;
    bubble.appendChild(heading);

    const note = document.createElement("div");
    note.style.fontSize = "12px";
    note.style.color = "var(--muted)";
    note.style.marginBottom = "12px";
    note.textContent = "Shown before AI summarisation so you can see what the sources actually say.";
    bubble.appendChild(note);

    result.items.forEach((item, i) => {
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
      meta.textContent = `${item.domain}${item.date ? " · " + item.date : ""}`;

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
    summarize.addEventListener("click", () => summarizeLocally(q, result, summarize));

    const refresh = document.createElement("button");
    refresh.textContent = "Refresh sources";
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      refresh.textContent = "Refreshing…";
      try {
        const newer = await searchNews(q);
        const newBubble = renderResults(q, newer);
        newBubble?.scrollIntoView({behavior:"smooth", block:"end"});
      } catch (e) {
        addMessage("assistant", "I couldn't refresh the live sources: " + (e?.message || e));
      } finally {
        refresh.disabled = false;
        refresh.textContent = "Refresh sources";
      }
    });

    controls.append(summarize, refresh);
    bubble.appendChild(controls);
    return bubble;
  }

  function summarizeLocally(originalQ, result, button) {
    const input = $("input");
    const send = $("send");
    const mode = $("researchMode");
    if (!input || !send) return;

    const compact = result.items.map((x, i) => `${i + 1}. ${x.title} (${x.domain}${x.date ? ", " + x.date : ""})`).join("\n");
    const prompt = `Give a short factual summary of the items below. Use only the text shown. Do not invent details. If the items are unrelated, say that clearly.\n\n${compact}`;

    const previousMode = mode?.value;
    if (mode) mode.value = "never";
    input.value = prompt;

    bypass = true;
    button.disabled = true;
    button.textContent = "Summarising…";
    try {
      send.click();
      const userBubbles = document.querySelectorAll(".msg.user .bubble");
      const last = userBubbles[userBubbles.length - 1];
      if (last) last.textContent = "Summarise these source items";
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
    const bubble = addMessage("assistant", "Searching live sources…");
    try {
      const result = await searchNews(q);
      bubble.parentElement?.remove();
      renderResults(q, result);
    } catch (e) {
      bubble.textContent = "I couldn't reach live headline sources, so I won't fake a current answer. " + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  function shouldIntercept(q) {
    if (bypass || busy || !isNewsQuery(q)) return false;
    const mode = $("researchMode");
    if (mode?.value === "never") return false;
    return true;
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
    document.querySelectorAll(".status").forEach(el => {
      if (/Research/.test(el.textContent || "")) el.textContent = "Research: live headlines first + optional local summary";
    });
  });
})();
