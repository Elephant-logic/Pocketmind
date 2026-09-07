from pathlib import Path
import re

VERSION = "1.0"
BADGE = f"PWA v{VERSION} WEB"

cpu = Path("dist/cpu.js")
s = cpu.read_text()
s = s.replace("tensorblock/SmolLM2-360M-Instruct-GGUF", "bartowski/SmolLM2-360M-Instruct-GGUF")
s = re.sub(
    r"async function diagnostic\(show=true\)\{.*?\n\}\nasync function load\(\)",
    '''async function diagnostic(show=true){
  if(!allowed()){if(show)add("system","PocketMind needs HTTPS.");return false;}
  if(!navigator.onLine){if(show)add("system","The first model download needs internet.");return false;}
  progress(0,"Bundled CPU runtime is ready to test directly.");
  if(show)add("system","PocketMind v1.0 bundles its CPU runtime with the app. Load Local AI tests the real runtime directly.");
  return true;
}
async function load()''',
    s,
    flags=re.S,
)
s = s.replace('if(!await diagnostic(false)){add("system","Pre-load check failed. Tap Run connection test for details.");return;}\n', '')
s = s.replace('const pkg=await import("https://cdn.jsdelivr.net/npm/@wllama/wllama@3.6.1/+esm");', 'const pkg=await import("./vendor/wllama/esm/index.js");')
s = s.replace('default:"https://cdn.jsdelivr.net/npm/@wllama/wllama@3.6.1/esm/wasm/wllama.wasm"', 'default:"./vendor/wllama/esm/wasm/wllama.wasm"')
s = re.sub(r'\n\s*// Force the plain CPU/WASM path.*?try\{engine\.setCompat\(null\);\}catch\(e\)\{\}', '', s, flags=re.S)
s = re.sub(r'\{n_ctx:\d+,n_batch:\d+,n_threads:1,n_gpu_layers:0', '{n_ctx:768,n_batch:16,n_threads:1,n_gpu_layers:0', s)
s = re.sub(r'PocketMind v[0-9.]+ is using (?:bundled )?CPU/WebAssembly', 'PocketMind v1.0 is using bundled CPU/WebAssembly', s)
s = s.replace(
    'If evidence is insufficient, say so.`;',
    'If evidence is insufficient, say so. Keep normal answers concise, usually under 120 words. Always finish the final sentence; never stop mid-sentence.`;'
)
s = re.sub(
    r'function shouldResearch\(q\)\{.*?\n\}',
    lambda _: '''function shouldResearch(q){
  const mode=$("researchMode").value;
  if(mode==="always")return true;
  if(mode==="never")return false;
  return /\\b(latest|today|current|news|headlines|breaking|recent|updated|happening|search|internet|web|weather|price|prices)\\b/i.test(q);
}''',
    s,
    count=1,
    flags=re.S,
)
s = s.replace('.slice(0,1600)', '.slice(0,650)')
s = s.replace('let engine=null,loading=false,ready=false,deferredInstall=null;', 'let engine=null,loading=false,ready=false,deferredInstall=null,generationAbort=null;')

s = re.sub(
    r'async function send\(\)\{.*?\n\}\nfunction addMemory',
    r'''async function send(){
  const inp=$("input"),btn=$("send");
  if(generationAbort){generationAbort.abort();return;}
  const q=inp.value.trim();if(!q)return;
  inp.value="";add("user",q);
  const m=remember(q);if(m){add("assistant",`I’ll remember: "${m}"`);return;}
  if(!ready){add("system","Load the local AI first.");return;}
  btn.textContent="Stop";
  generationAbort=new AbortController();
  const controller=generationAbort;
  const isExternalContext=q.startsWith("NEWS_SUMMARY_REQUEST")||q.startsWith("WEB_SEARCH_REQUEST");
  let ticker=null,bubble=null,gotToken=false;
  const started=Date.now();
  try{
    let page=null;
    if(!isExternalContext&&shouldResearch(q)&&navigator.onLine){try{page=await research(q);}catch(e){console.warn(e);}}
    bubble=add("assistant","Thinking locally… 0s");
    ticker=setInterval(()=>{if(!gotToken&&bubble){bubble.textContent=`Thinking locally… ${Math.floor((Date.now()-started)/1000)}s`; }},1000);
    const allMessages=messages(q,page);
    const modelMessages=isExternalContext?[allMessages[0],allMessages[allMessages.length-1]]:allMessages;
    const stream=await engine.createChatCompletion({messages:modelMessages,max_tokens:isExternalContext?256:192,temperature:.25,top_p:.9,top_k:40,stream:true,abortSignal:controller.signal});
    let ans="";
    for await(const chunk of stream){const delta=chunk?.choices?.[0]?.delta?.content||"";if(delta){if(!gotToken){gotToken=true;if(ticker){clearInterval(ticker);ticker=null;}}ans+=delta;bubble.textContent=ans;$("chat").scrollTop=$("chat").scrollHeight;}}
    if(!ans)bubble.textContent="I couldn't produce an answer.";
    if(page){const d=document.createElement("div");d.className="sources";d.innerHTML="<strong>Source</strong>";const a=document.createElement("a");a.target="_blank";a.rel="noopener";a.href=page.url;a.textContent=page.title;d.appendChild(a);bubble.appendChild(d);}
    if(ans&&!isExternalContext){recent.push({role:"user",content:q},{role:"assistant",content:ans});if(recent.length>6)recent=recent.slice(-6);sessionStorage.setItem(CHAT_KEY,JSON.stringify(recent));}
  }catch(e){if(controller.signal.aborted){if(bubble&&!gotToken)bubble.textContent="Stopped.";}else add("system","Generation failed: "+(e?.message||e));}
  finally{if(ticker)clearInterval(ticker);if(generationAbort===controller)generationAbort=null;btn.textContent="Send";}
}
function addMemory''',
    s,
    count=1,
    flags=re.S,
)
cpu.write_text(s)

news = Path("dist/news-v09.js")
n = news.read_text()
n = re.sub(r'const VERSION = "PWA v[^"]+";', f'const VERSION = "{BADGE}";', n, count=1)
n = re.sub(
    r'    const compact = items\.map\(\(x, i\) => .*?\n    const prompt = `.*?`;\n',
    lambda _: '''    const compact = items.map((x, i) => {
      const shortSummary = String(x.summary || "").replace(/\\s+/g, " ").trim().slice(0, 140);
      return `${i + 1}. ${x.title} — ${x.source}${shortSummary ? ` — ${shortSummary}` : ""}`;
    }).join("\\n");
    const prompt = "NEWS_SUMMARY_REQUEST\\n" +
      `Summarise all ${items.length} source items. Write exactly one short bullet for each numbered item, in the same order. ` +
      "Keep each bullet under 18 words. Use only the supplied text, do not invent facts, and do not omit an item.\\n\\n" + compact;
''',
    n,
    count=1,
    flags=re.S,
)
news.write_text(n)

web = Path("dist/web-search.js")
ws = web.read_text()
ws = re.sub(r'const VERSION = "PWA v[^"]+";', f'const VERSION = "{BADGE}";', ws, count=1)
web.write_text(ws)

index = Path("dist/index.html")
h = index.read_text()
h = re.sub(r'PWA v[0-9.]+(?: SERVER NEWS| NEWS| CPU| WEB)?', BADGE, h)
h = re.sub(r'PocketMind v[0-9.]+', f'PocketMind v{VERSION}', h)
h = re.sub(r'<title>.*?</title>', f'<title>PocketMind AI v{VERSION}</title>', h, count=1)
if 'web-search.js' not in h:
    h = h.replace('</body>', '<script src="web-search.js"></script>\n</body>')
index.write_text(h)

sw = Path("dist/sw.js")
w = sw.read_text()
w = re.sub(r'pocketmind-shell-v[0-9]+', 'pocketmind-shell-v1000', w, count=1)
w = re.sub(r'pocketmind-news-v[0-9]+', 'pocketmind-news-v1000', w, count=1)
if '"./web-search.js"' not in w:
    w = w.replace('"./news-v09.js",', '"./news-v09.js",\n  "./web-search.js",')
sw.write_text(w)
