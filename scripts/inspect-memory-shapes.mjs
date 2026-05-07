#!/usr/bin/env node

const baseUrl = process.env.HINDSIGHT_BASE_URL?.trim() || "http://127.0.0.1:8888";
const banks = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["pi-ghosty-procedural", "pi-ghosty-personal"]);

async function getJson(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
  });
  const text = await res.text();
  const data = text.trim() ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(data)}`);
  return data;
}

function simplifyDocument(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    bank_id: doc.bank_id,
    text_length: doc.text_length,
    memory_unit_count: doc.memory_unit_count,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    tags: doc.tags,
    retain_params: doc.retain_params,
  };
}

function simplifyMemory(m) {
  if (!m) return null;
  return {
    id: m.id,
    fact_type: m.fact_type,
    text: m.text,
    context: m.context,
    date: m.date,
    chunk_id: m.chunk_id,
    proof_count: m.proof_count,
    tags: m.tags,
    entities: m.entities,
  };
}

async function inspectBank(bankId) {
  const cfg = await getJson(`/v1/default/banks/${encodeURIComponent(bankId)}/config`);
  const docs = await getJson(`/v1/default/banks/${encodeURIComponent(bankId)}/documents?limit=5`);
  const world = await getJson(`/v1/default/banks/${encodeURIComponent(bankId)}/memories/list?type=world&limit=5`);
  const observations = await getJson(`/v1/default/banks/${encodeURIComponent(bankId)}/memories/list?type=observation&limit=5`);
  const stats = await getJson(`/v1/default/banks/${encodeURIComponent(bankId)}/stats`);

  return {
    bank_id: bankId,
    config: {
      retain_mission: cfg?.config?.retain_mission,
      retain_extraction_mode: cfg?.config?.retain_extraction_mode,
      enable_observations: cfg?.config?.enable_observations,
      observations_mission: cfg?.config?.observations_mission,
      overrides: cfg?.overrides,
    },
    stats: {
      total_documents: stats.total_documents,
      total_nodes: stats.total_nodes,
      total_observations: stats.total_observations,
      nodes_by_fact_type: stats.nodes_by_fact_type,
      pending_operations: stats.pending_operations,
      pending_consolidation: stats.pending_consolidation,
      last_consolidated_at: stats.last_consolidated_at,
    },
    documents: (docs.items || []).map(simplifyDocument),
    sample_world_facts: (world.items || []).map(simplifyMemory),
    sample_observations: (observations.items || []).map(simplifyMemory),
  };
}

(async () => {
  const out = {
    base_url: baseUrl,
    inspected_at: new Date().toISOString(),
    banks: [],
  };

  for (const bankId of banks) {
    out.banks.push(await inspectBank(bankId));
  }

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
