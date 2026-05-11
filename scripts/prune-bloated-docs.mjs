#!/usr/bin/env node

const baseUrl = process.env.HINDSIGHT_BASE_URL?.trim() || "http://127.0.0.1:8888";
const banks = ["pi-ghosty-procedural", "pi-ghosty-personal"];
const LENGTH_THRESHOLD = 50000; // Anything over 50k chars is considered a bloated doc

async function getDocs(bankId) {
  const url = `${baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents?limit=100`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to list docs for ${bankId}: ${res.status} ${text}`);
    return [];
  }
  const data = await res.json();
  return data.items || [];
}

async function deleteDoc(bankId, docId) {
  const url = `${baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents/${encodeURIComponent(docId)}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to delete doc ${docId} from ${bankId}: ${res.status} ${text}`);
    return false;
  }
  return true;
}

async function main() {
  console.log(`Starting document pruning...`);
  console.log(`Targeting documents with length > ${LENGTH_THRESHOLD}\n`);
  
  for (const bankId of banks) {
    console.log(`Inspecting bank: ${bankId}`);
    const docs = await getDocs(bankId);
    
    const bloatedDocs = docs.filter(doc => doc.text_length > LENGTH_THRESHOLD);
    console.log(`  Found ${docs.length} total docs. ${bloatedDocs.length} are bloated.`);
    
    for (const doc of bloatedDocs) {
      console.log(`  - Deleting doc: ${doc.id} (length: ${doc.text_length}, units: ${doc.memory_unit_count})`);
      const success = await deleteDoc(bankId, doc.id);
      if (success) {
        console.log(`    Successfully deleted.`);
      }
    }
  }
  
  console.log(`\nPruning complete. Hindsight will automatically queue background tasks to clean up orphaned tags or observations.`);
}

main().catch(console.error);
