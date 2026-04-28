import { execSync } from 'child_process';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node bb-ground.mjs <url_or_search_query>');
  process.exit(1);
}

function bb(command) {
  try {
    return execSync(`bb-browser ${command} --json`, { encoding: 'utf8' });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

async function ground() {
  console.log(`[bb-ground] Grounding: ${target}`);

  // 1. Determine if it's a URL or a search
  const isUrl = target.startsWith('http');
  
  if (isUrl) {
    // Open and wait
    bb(`open "${target}"`);
    console.log(`[bb-ground] Waiting for page load...`);
    await new Promise(r => setTimeout(r, 2000));

    // Try to get clean text via eval (the "dumb but reliable" way)
    const result = bb(`eval "document.body.innerText.substring(0, 10000)"`);
    const data = JSON.parse(result);

    if (data.success) {
      console.log(`--- CONTENT START ---`);
      console.log(data.data.result);
      console.log(`--- CONTENT END ---`);
      
      // Cleanup
      bb(`close`);
    } else {
      console.error(`[bb-ground] Failed to extract content: ${data.error}`);
    }
  } else {
    // It's a search. Try Google then DuckDuckGo
    console.log(`[bb-ground] Attempting search via Google adapter...`);
    let search = JSON.parse(bb(`site google/search "${target}"`));
    
    if (!search.success || search.data.count === 0) {
      console.log(`[bb-ground] Google adapter returned 0. Trying DuckDuckGo...`);
      search = JSON.parse(bb(`site duckduckgo/search "${target}"`));
    }

    if (search.success && search.data.count > 0) {
      console.log(JSON.stringify(search.data, null, 2));
    } else {
      console.log(`[bb-ground] All search adapters failed. Falling back to manual search...`);
      // Manual fallback: open Google and just grab the text
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
      bb(`open "${searchUrl}"`);
      await new Promise(r => setTimeout(r, 3000));
      const raw = JSON.parse(bb(`eval "document.body.innerText.substring(0, 5000)"`));
      console.log(raw.data.result);
      bb(`close`);
    }
  }
}

ground();
