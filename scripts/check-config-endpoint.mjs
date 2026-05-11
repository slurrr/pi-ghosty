async function main() {
  const proceduralBankId = "pi-ghosty-procedural";
  const res = await fetch(`http://localhost:8888/v1/default/banks/${proceduralBankId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      updates: {
        retain_mission: "Test mission"
      }
    })
  });
  console.log(res.status, res.statusText);
  const text = await res.text();
  console.log(text);
}
main().catch(console.error);
