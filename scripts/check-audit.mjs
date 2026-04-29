import { HindsightClient } from "@vectorize-io/hindsight-client";

async function main() {
  const client = new HindsightClient({ baseUrl: "http://localhost:8888" });
  
  const banks = ["pi-ghosty-procedural", "pi-ghosty-personal"];
  
  for (const bankId of banks) {
    console.log(`\n--- Audit Logs for Bank: ${bankId} ---`);
    try {
      // @ts-ignore - reaching into the client to get logs
      const url = `http://localhost:8888/v1/default/banks/${bankId}/audit?limit=2`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          console.log(`Action: ${item.action} | Status: ${item.response?.status || 'unknown'}`);
          // We want to see the metadata or internal details of the retain operation if available
          if (item.action === "retain") {
            console.log("Retain Metadata:", JSON.stringify(item.metadata, null, 2));
            // In some hindsight versions, the actual LLM prompt might be in a separate debug field or operation log
          }
        }
      } else {
        console.log("No audit logs found.");
      }
    } catch (err) {
      console.error(`Error fetching logs for ${bankId}:`, err.message);
    }
  }
}

main().catch(console.error);
