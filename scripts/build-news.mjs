import { XMLParser } from "fast-xml-parser";
import { writeFile, mkdir } from "node:fs/promises";

const feeds = [
  { category: "uk", source: "BBC News", url: "https://feeds.bbci.co.uk/news/uk/rss.xml" },
  { category: "uk", source: "Sky News", url: "https://feeds.skynews.com/feeds/rss/uk.xml" },
  { category: "uk", source: "The Guardian", url: "https://www.theguardian.com/uk-news/rss" },
  { category: "world", source: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { category: "world", source: "Sky News", url: "https://feeds.skynews.com/feeds/rss/world.xml" },
  { category: "world", source: "The Guardian", url: "https://www.theguardian.com/world/rss" }
];

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  processEntities: true
});

function arrayify(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function itemLink(item) {
  if (typeof item.link === "string") return item.link;
  if (item.link?.["@_href"]) return item.link["@_href"];
  if (typeof item.guid === "string" && /^https?:/i.test(item.guid)) return item.guid;
  if (item.guid?.["#text"] && /^https?:/i.test(item.guid["#text"])) return item.guid["#text"];
  return "";
}

function parseDate(item) {
  const raw = item.pubDate || item.updated || item.published || item["dc:date"] || "";
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "PocketMind-News/0.9 (+https://elephant-logic.github.io/Pocketmind/)"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadFeed(feed) {
  const xml = await fetchText(feed.url);
  const data = parser.parse(xml);
  const rssItems = arrayify(data?.rss?.channel?.item);
  const atomItems = arrayify(data?.feed?.entry);
  const items = rssItems.length ? rssItems : atomItems;

  return items.map(item => ({
    category: feed.category,
    source: feed.source,
    title: stripHtml(item.title?.["#text"] ?? item.title ?? ""),
    url: itemLink(item),
    publishedAt: parseDate(item),
    summary: stripHtml(item.description ?? item.summary ?? item.content?.["#text"] ?? "").slice(0, 320)
  })).filter(item => item.title && item.url);
}

const results = await Promise.allSettled(feeds.map(loadFeed));
const sourceStatus = [];
const all = [];

results.forEach((result, i) => {
  const feed = feeds[i];
  if (result.status === "fulfilled") {
    all.push(...result.value);
    sourceStatus.push({ source: feed.source, category: feed.category, ok: true, count: result.value.length });
  } else {
    sourceStatus.push({ source: feed.source, category: feed.category, ok: false, error: String(result.reason?.message || result.reason) });
  }
});

if (!all.length) {
  console.error(sourceStatus);
  throw new Error("All RSS news sources failed; keeping the previous Pages deployment instead.");
}

const seen = new Set();
const deduped = all.filter(item => {
  const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
});

deduped.sort((a, b) => {
  const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  return bt - at;
});

const categories = {};
for (const category of ["uk", "world"]) {
  categories[category] = deduped.filter(x => x.category === category).slice(0, 30);
}

await mkdir("dist", { recursive: true });
await writeFile("dist/news.json", JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  refreshTargetMinutes: 15,
  categories,
  sourceStatus
}, null, 2));

console.log(`news.json: UK=${categories.uk.length}, world=${categories.world.length}`);
console.log(sourceStatus);
