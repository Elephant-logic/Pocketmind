(() => {
  const VERSION = "PWA v1.0 WEB";
  let busy = false;
  let bypass = false;
  const $ = id => document.getElementById(id);

  function isNewsQuery(q) {
    return /\b(news|headlines|breaking|latest news|current news|recent news|what(?:'s| is) happening)\b/i.test(q || "");
  }

  function isWebQuery(q) {
    const mode = $("researchMode")?.value;
    if (mode === "never" || isNewsQuery(q)) return false;
    if (mode === "always") return true;
    return /\b(search(?: the)? (?:web|internet)|search for|look up|lookup|find online|check online|on the web|on the internet|web search|internet search|research|current|latest|today)\b/i.test(q || "");
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

  function jsonp(url, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const cb = "pm_ddg_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");
      const timer = setTimeout(() => cleanup(new Error("DuckDuckGo lookup timed out")), timeoutMs);
      function cleanup(err, value) {
        clearTimeout(timer);
        delete window[cb];
        script.remove();
        err ? reject(err) : resolve(value);
      }
      window[cb] = data => cleanup(null, data);
      script.onerror = () => cleanup(new Error("DuckDuckGo lookup failed"));
      script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + encodeURIComponent(cb);
      document.head.appendChild(script);
    });
  }

  async function duckDuckGo(q) {
    const params = new URLSearchParams({q, format:"json", no_html:"1", no_redirect:"1", skip_disambig:"0", t:"pocketmind"});
    const url = "https://api.duckduckgo.com/?" + params.toString();
    let data;
    try {
      const r = await fetch(url, {cache:"no-store"});
      if (!r.ok) throw new Error("HTTP " + r.status);
      data = await r.json();
    } catch (_) {
      data = await jsonp(url);
    }
    const out = [];
    const seen = new Set();
    const push = (title, text, url, source) => {
      if (!text && !title) return;
      const key = url || (title + text);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({title:title || source || "Result", text:text || "", url:url || "", source:source || "DuckDuckGo"});
    };
    if (data.Answer) push("Instant answer", String(data.Answer), data.AnswerType ? "" : "", "DuckDuckGo");
    if (data.AbstractText) push(data.Heading || "Topic summary", data.AbstractText, data.AbstractURL || "", data.AbstractSource || "DuckDuckGo");
    (data.Results || []).forEach(x => push(x.Text || "Result", x.Text || "", x.FirstURL || "", "DuckDuckGo"));
    const walk = arr => (arr || []).forEach(x => {
      if (x.Topics) walk(x.Topics);
      else push((x.Text || "").split(" - ")[0] || "Related result", x.Text || "", x.FirstURL || "", "DuckDuckGo");
    });
    walk(data.RelatedTopics);
    return out.slice(0, 5);
  }

  async function wikipedia(q) {
    const p = new URLSearchParams({action:"query", list:"search", srsearch:q, format:"json", origin:"*", utf8:"1", srlimit:"4"});
    const r = await fetch("https://en.wikipedia.org/w/api.php?" + p.toString(), {cache:"no-store"});
    if (!r.ok) throw new Error("Wikipedia HTTP " + r.status);
    const data = await r.json();
    return (data.query?.search || []).slice(0, 4).map(x => ({
      title: x.title,
      text: String(x.snippet || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#039;/g, "'"),
      url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(x.title.replace(/ /g, "_")),
      source: "Wikipedia"
    }));
  }

  async function lookup(q) {
    let ddg = [];
    let wiki = [];
    try { ddg = await duckDuckGo(q); } catch (e) { console.warn(e); }
    if (ddg.length < 3) {
      try { wiki = await wikipedia(q); } catch (e) { console.warn(e); }
    }
    const all = [...ddg, ...wiki];
    const seen = new Set();
    return all.filter(x => {
      const key = x.url || x.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5);
  }

  function renderResults(q, items) {
    const bubble = addMessage("assistant", "");
    const h = document.createElement("div");
    h.style.fontWeight = "700";
    h.textContent = "Internet lookup results";
    bubble.appendChild(h);

    if (!items.length) {
      const p = document.createElement("div");
      p.style.marginTop = "8px";
      p.textContent = "No structured result came back from the public lookup services.";
      bubble.appendChild(p);
    }

    items.forEach((item, i) => {
      const row = document.createElement("div");
      row.style.padding = "10px 0";
      row.style.borderTop = i ? "1px solid var(--border)" : "0";
      const title = item.url ? document.createElement("a") : document.createElement("div");
      if (item.url) { title.href = item.url; title.target = "_blank"; title.rel = "noopener"; }
      title.style.color = item.url ? "#58a6ff" : "var(--text)";
      title.style.fontWeight = "600";
      title.style.textDecoration = "none";
      title.textContent = `${i + 1}. ${item.title}`;
      const text = document.createElement("div");
      text.style.fontSize = "13px";
      text.style.marginTop = "4px";
      text.textContent = item.text;
      const meta = document.createElement("div");
      meta.style.fontSize = "11px";
      meta.style.color = "var(--muted)";
      meta.textContent = item.source;
      row.append(title, text, meta);
      bubble.appendChild(row);
    });

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "8px";
    controls.style.flexWrap = "wrap";
    controls.style.marginTop = "12px";

    if (items.length) {
      const ask = document.createElement("button");
      ask.className = "primary";
      ask.textContent = "Answer using local AI";
      ask.onclick = () => answerLocally(q, items, ask);
      controls.appendChild(ask);
    }

    const full = document.createElement("a");
    full.href = "https://duckduckgo.com/?q=" + encodeURIComponent(q);
    full.target = "_blank";
    full.rel = "noopener";
    full.style.display = "inline-block";
    full.style.padding = "9px 11px";
    full.style.border = "1px solid var(--border)";
    full.style.borderRadius = "10px";
    full.style.color = "#58a6ff";
    full.style.textDecoration = "none";
    full.textContent = "Open full web search";
    controls.appendChild(full);
    bubble.appendChild(controls);
  }

  function answerLocally(q, items, button) {
    const input = $("input");
    const send = $("send");
    const mode = $("researchMode");
    if (!input || !send) return;
    const evidence = items.map((x, i) => `${i + 1}. ${x.title} | ${x.source} | ${String(x.text || "").replace(/\s+/g, " ").slice(0, 180)} | ${x.url || "no-url"}`).join("\n");
    input.value = `WEB_SEARCH_REQUEST\nQuestion: ${q}\nUse only the evidence below. If it does not answer the question, say that. Cite source numbers in brackets.\n\n${evidence}`;
    const oldMode = mode?.value;
    if (mode) mode.value = "never";
    bypass = true;
    button.disabled = true;
    button.textContent = "Sending to local AI…";
    send.click();
    const users = document.querySelectorAll(".msg.user .bubble");
    const last = users[users.length - 1];
    if (last) last.textContent = `Answer from internet lookup: ${q}`;
    setTimeout(() => {
      bypass = false;
      if (mode && oldMode != null) mode.value = oldMode;
      button.disabled = false;
      button.textContent = "Answer using local AI";
    }, 1200);
  }

  async function handle(q) {
    if (busy) return;
    busy = true;
    const input = $("input");
    if (input) input.value = "";
    addMessage("user", q);
    const waiting = addMessage("assistant", "Searching the internet…");
    try {
      const items = await lookup(q);
      waiting.parentElement?.remove();
      renderResults(q, items);
    } catch (e) {
      waiting.textContent = "Internet lookup failed: " + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  function intercept(q) { return !bypass && !busy && isWebQuery(q); }

  document.addEventListener("click", e => {
    const btn = e.target?.closest?.("#send");
    if (!btn) return;
    const q = $("input")?.value?.trim() || "";
    if (!intercept(q)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    handle(q);
  }, true);

  document.addEventListener("keydown", e => {
    if (e.target?.id !== "input" || e.key !== "Enter" || e.shiftKey) return;
    const q = e.target.value.trim();
    if (!intercept(q)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    handle(q);
  }, true);

  window.addEventListener("DOMContentLoaded", () => {
    const badge = document.querySelector(".badge");
    if (badge) badge.textContent = VERSION;
  });
})();
