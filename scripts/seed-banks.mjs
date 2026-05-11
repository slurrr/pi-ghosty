async function main() {
  const baseUrl = "http://localhost:8888";
  
  for (const bankId of ["pi-ghosty-procedural", "pi-ghosty-personal"]) {
    console.log(`Seeding bank: ${bankId}`);
    const res = await fetch(`${baseUrl}/v1/default/banks/${bankId}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            content: "Initializing bank",
            context: "system init",
            document_id: "init",
            update_mode: "replace"
          }
        ]
      })
    });
    console.log(res.status, await res.text());
  }
}
main().catch(console.error);
