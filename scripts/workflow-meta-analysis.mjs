#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const reviewsDir = process.argv[2] || "/home/poop/runs/pi-ghosty/data/workflow/reviews";

function safeJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const files = readdirSync(reviewsDir)
  .filter((f) => f.endsWith(".json"))
  .sort((a, b) => a.localeCompare(b));

const byKey = new Map();
const byCategory = new Map();
const byStatus = new Map();

for (const f of files) {
  const full = resolve(reviewsDir, f);
  const review = safeJson(full);
  if (!review) continue;

  const all = [
    ...(Array.isArray(review.candidates) ? review.candidates : []),
    ...(Array.isArray(review.winners) ? review.winners : []),
    ...(Array.isArray(review.parked) ? review.parked : []),
    ...(Array.isArray(review.topScreened) ? review.topScreened : []),
  ];

  const seenIds = new Set();
  for (const c of all) {
    const id = String(c?.id || "").trim();
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const key = `${String(c?.category || "unknown")}||${String(c?.title || "untitled")}||${String(c?.status || "unknown")}`;
    const rec = byKey.get(key) || {
      id,
      category: String(c?.category || "unknown"),
      title: String(c?.title || "untitled"),
      status: String(c?.status || "unknown"),
      kind: String(c?.kind || "unknown"),
      firstSeen: c?.firstSeen || review.ts,
      lastSeen: c?.lastSeen || review.ts,
      reviewCount: 0,
      sessions: new Set(),
      evidenceCount: 0,
      totalCountScore: 0,
    };

    rec.reviewCount += 1;
    rec.totalCountScore += Number(c?.count || 0);

    const ev = Array.isArray(c?.evidence) ? c.evidence : [];
    rec.evidenceCount += ev.length;
    for (const e of ev) {
      const sid = String(e?.sessionId || "").trim();
      if (sid) rec.sessions.add(sid);
    }

    if (String(c?.lastSeen || "") > rec.lastSeen) rec.lastSeen = String(c.lastSeen);
    if (String(c?.firstSeen || "") < rec.firstSeen) rec.firstSeen = String(c.firstSeen);

    byKey.set(key, rec);

    byCategory.set(rec.category, (byCategory.get(rec.category) || 0) + 1);
    byStatus.set(rec.status, (byStatus.get(rec.status) || 0) + 1);
  }
}

const flattened = [...byKey.values()].map((r) => ({
  ...r,
  distinctSessions: r.sessions.size,
}));

flattened.sort((a, b) => {
  if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount;
  if (b.distinctSessions !== a.distinctSessions) return b.distinctSessions - a.distinctSessions;
  if (b.totalCountScore !== a.totalCountScore) return b.totalCountScore - a.totalCountScore;
  return a.title.localeCompare(b.title);
});

const persistent = flattened.filter((r) => r.reviewCount >= 3 || r.distinctSessions >= 3);
const oneOff = flattened.filter((r) => r.reviewCount === 1 && r.distinctSessions <= 1);

function topMap(map, n = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

console.log(`workflow review meta-analysis`);
console.log(`reviewsDir: ${reviewsDir}`);
console.log(`reviewFiles: ${files.length}`);
console.log(`uniqueItems: ${flattened.length}`);
console.log("");

console.log("status frequency (item appearances across reviews):");
for (const [k, v] of topMap(byStatus)) console.log(`- ${k}: ${v}`);
console.log("");

console.log("category frequency (item appearances across reviews):");
for (const [k, v] of topMap(byCategory)) console.log(`- ${k}: ${v}`);
console.log("");

console.log(`persistent themes (${persistent.length}) [>=3 reviews OR >=3 distinct sessions]:`);
for (const r of persistent.slice(0, 15)) {
  console.log(`- [${r.status}] ${r.category} :: ${r.title} | reviews=${r.reviewCount} sessions=${r.distinctSessions} evidence=${r.evidenceCount}`);
}
console.log("");

console.log(`one-off session noise (${oneOff.length}) [1 review and <=1 session]:`);
for (const r of oneOff.slice(0, 15)) {
  console.log(`- [${r.status}] ${r.category} :: ${r.title} | reviews=${r.reviewCount} sessions=${r.distinctSessions} evidence=${r.evidenceCount}`);
}

console.log("");
console.log("top recurring items overall:");
for (const r of flattened.slice(0, 20)) {
  console.log(`- [${r.status}] ${r.category} :: ${r.title} | reviews=${r.reviewCount} sessions=${r.distinctSessions} totalCount=${r.totalCountScore}`);
}
