import { HindsightClient } from "@vectorize-io/hindsight-client";

export interface HindsightConfig {
  baseUrl: string;
  bankId: string;
}

export function createHindsightClient(cfg: HindsightConfig): HindsightClient {
  return new HindsightClient({ baseUrl: cfg.baseUrl });
}

