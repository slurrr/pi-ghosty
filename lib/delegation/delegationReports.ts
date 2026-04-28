import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DelegationReport } from "./contracts.js";

export function delegationReportTitle(peerName: string, jobId: string): string {
  return `${peerName}-${jobId}`;
}

export function delegationReportTimestampPrefix(completedAt: string): string {
  const parsed = Date.parse(completedAt);
  const ms = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(Math.max(0, Math.trunc(ms))).toISOString().replace(/:/g, "-");
}

export function delegationReportFileName(report: Pick<DelegationReport, "peerName" | "jobId" | "completedAt">): string {
  return `${delegationReportTimestampPrefix(report.completedAt)}-${delegationReportTitle(report.peerName, report.jobId)}.json`;
}

export function delegationReportPath(runDir: string, report: Pick<DelegationReport, "peerName" | "jobId" | "completedAt">): string {
  return resolve(runDir, "data", "delegation-reports", delegationReportFileName(report));
}

export function writeDelegationReport(runDir: string, report: DelegationReport): string {
  const reportPath = delegationReportPath(runDir, report);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return reportPath;
}
