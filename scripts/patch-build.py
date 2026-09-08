from pathlib import Path
import re

VERSION = "1.1"
BADGE = f"PWA v{VERSION} WEB"

cpu = Path("dist/cpu.js")
s = cpu.read_text()

# Keep the proven Android CPU/WASM path, but use the working model host and bundled runtime.
s = s.replace("tensorblock/SmolLM2-360M-Instruct-GGUF", "bartowski/SmolLM2-360M-Instruct-GGUF")
s = re.sub(
    r"async function diagnostic\(show=true\)\{.*?\n\}\nasync function load\(\)",
    '''async function diagnostic(show=true){
  if(!allowed()){if(show)add("system","PocketMind needs HTTPS.");return false;}
  progress(0,"Bundled CPU runtime is ready.");
  if(show)add("system","PocketMind v1.1 uses the bundled CPU/WebAssembly runtime. A cached model can be restored without downloading it again.");
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
s = re.sub(r'\{n_ctx:\d+,n_batch:\d+,n_threads:1,n_gpu_layers:0', '{n_ctx:1280,n_batch:16,n_threads:1,n_gpu_layers:0', s)
s = re.sub(r'PocketMind v[0-9.]+ is using (?:bundled )?CPU/WebAssembly', 'PocketMind v1.1 is using bundled CPU/WebAssembly', s)

# Give normal answers room to finish, while still asking the tiny model to stay concise.
s = s.replace(
    'If evidence is insufficient, say so.`;',
    'If evidence is insufficient, say so. Keep normal answers concise, usually under 150 words. Always complete the thought and finish the final sentence.`;'
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
s = s.replace(
    'let engine=null,loading=false,ready=false,deferredInstall=null;',
    'const AUTO_MODEL_KEY="pocketmind_auto_model_v11";\nlet engine=null,loading=false,ready=false,deferredInstall=null,generationAbort=null;'
)

# Remember that the user has successfully loaded the model before.
s = s.replace(
    'ready=true;status("CPU ready","good");progress(1,"Local CPU AI ready.");$("unloadBtn").disabled=false;',
    'ready=true;localStorage.setItem(AUTO_MODEL_KEY,"1");status("CPU ready","good");progress(1,"Local CPU AI ready.");$("unloadBtn").disabled=false;'
)

# Auto-restore an already cached GGUF into RAM. This never downloads a missing model.
auto_loader = r'''async function autoLoadCached(){
  if(ready||loading)return false;
  loading=true;
  $("loadModelBtn").disabled=true;$("mobileLoadBtn").disabled=true;$("modelSelect").disabled=true;
  status("restoring cached model…","warn");progress(.05,"Checking local model cache…");
  try{
    const pkg=await import("./vendor/wllama/esm/index.js");
    const wasmPaths={default:"./vendor/wllama/esm/wasm/wllama.wasm"};
    engine=new pkg.Wllama(wasmPaths,{allowOffline:true,parallelDownloads:2});
    const models=await engine.modelManager.getModels();
    const cached=models.find(m=>m&&m.size>0&&String(m.url||"").includes(MODEL.file));
    if(!cached){
      try{await engine.exit();}catch(e){}
      engine=null;status("not loaded");progress(0,"No cached model found. Tap Load local AI once to download it.");
      return false;
    }
    progress(.25,"Cached model found — loading it into memory…");
    await engine.loadModel(cached,{n_ctx:1280,n_batch:16,n_threads:1,n_gpu_layers:0});
    ready=true;localStorage.setItem(AUTO_MODEL_KEY,"1");status("CPU ready","good");progress(1,"Cached local AI restored.");$("unloadBtn").disabled=false;
    add("system","Cached local AI restored automatically. No model download was needed.");
    return true;
  }catch(e){
    console.warn("Cached model restore failed",e);
    try{if(engine)await engine.exit();}catch(_){}
    engine=null;ready=false;status("not loaded");progress(0,"Cached model could not be restored. Tap Load local AI to retry.");
    return false;
  }finally{
    loading=false;$("loadModelBtn").disabled=ready;$("mobileLoadBtn").disabled=ready;$("modelSelect").disabled=ready;
  }
}
'''
s = s.replace('async function unload(){', auto_loader + '\nasync function unload(){', 1)
s = s.replace(
    'engine=null;ready=false;status("not loaded");progress(0,"Model unloaded. Cached files may remain in browser storage.");',
    'engine=null;ready=false;localStorage.removeItem(AUTO_MODEL_KEY);status("not loaded");progress(0,"Model unloaded. Cached files remain in browser storage.");'
)

# Stream answers, then automatically continue once if the model hits its output ceiling.
s = re.sub(
    r'async function send\(\)\{.*?\n\}\nfunction addMemory',
    lambda _: r'''async function send(){
  const inp=$("input"),btn=$("send");
  if(generationAbort){generationAbort.abort();return;}
  const q=inp.value.trim();if(!q)return;
  inp.value="";add("user",q);
  const m=remember(q);if(m){add("assistant",`I’ll remember: "${m}"`);return;}
  if(!ready){add("system","Local AI is not ready yet. If it is cached, PocketMind will restore it automatically; otherwise tap Load local AI once.");return;}
  btn.textContent="Stop";
  generationAbort=new AbortController();
  const controller=generationAbort;
  const isExternalContext=q.startsWith("NEWS_SUMMARY_REQUEST")||q.startsWith("WEB_SEARCH_REQUEST");
  let ticker=null,bubble=null,gotToken=false,ans="",finishReason="";
  const started=Date.now();
  try{
    let page=null;
    if(!isExternalContext&&shouldResearch(q)&&navigator.onLine){try{page=await research(q);}catch(e){console.warn(e);}}
    bubble=add("assistant","Thinking locally… 0s");
    ticker=setInterval(()=>{if(!gotToken&&bubble){bubble.textContent=`Thinking locally… ${Math.floor((Date.now()-started)/1000)}s`; }},1000);
    const allMessages=messages(q,page);
    const modelMessages=isExternalContext?[allMessages[0],allMessages[allMessages.length-1]]:allMessages;

    const streamPart=async(msgs,maxTokens)=>{
      const stream=await engine.createChatCompletion({messages:msgs,max_tokens:maxTokens,temperature:.25,top_p:.9,top_k:40,stream:true,cache_prompt:true,abortSignal:controller.signal});
      for await(const chunk of stream){
        const choice=chunk?.choices?.[0];
        if(choice?.finish_reason)finishReason=choice.finish_reason;
        const delta=choice?.delta?.content||"";
        if(delta){
          if(!gotToken){gotToken=true;if(ticker){clearInterval(ticker);ticker=null;}}
          ans+=delta;bubble.textContent=ans;$("chat").scrollTop=$("chat").scrollHeight;
        }
      }
    };

    await streamPart(modelMessages,isExternalContext?384:320);
    const looksCut=ans.length>650&&!/[.!?…][\"')\]]?\s*$/.test(ans.trim());
    if(!controller.signal.aborted&&(finishReason==="length"||looksCut)){
      finishReason="";
      const continuation=[...modelMessages,{role:"assistant",content:ans},{role:"user",content:"Continue the unfinished answer from exactly where it stopped. Do not repeat earlier text. Finish the answer briefly and end with a complete sentence."}];
      await streamPart(continuation,160);
    }

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

# Installed app (or a user who has loaded before) should restore the cached model automatically.
s = s.replace(
    'if(standalone()){$("installBtn").classList.add("installHidden");$("mobileInstallBtn").classList.add("installHidden");}\n})();',
    'if(standalone()){$("installBtn").classList.add("installHidden");$("mobileInstallBtn").classList.add("installHidden");}\n  if(standalone()||localStorage.getItem(AUTO_MODEL_KEY)==="1")setTimeout(()=>autoLoadCached(),0);\n})();'
)
cpu.write_text(s)

# Keep the working server-fetched news and web lookup UI, only bump the version.
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
w = re.sub(r'pocketmind-shell-v[0-9]+', 'pocketmind-shell-v1100', w, count=1)
w = re.sub(r'pocketmind-news-v[0-9]+', 'pocketmind-news-v1100', w, count=1)
if '"./web-search.js"' not in w:
    w = w.replace('"./news-v09.js",', '"./news-v09.js",\n  "./web-search.js",')
sw.write_text(w)
