
const baseUrl = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  console.log(`Checking game page at ${baseUrl}`);

  const response = await fetch(baseUrl);

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }

  const html = await response.text();

  const checks = [
    ["HTML document", /<html[\s>]/i.test(html)],
    ["Game interface content", /Dalal Street|game|lobby/i.test(html)]
  ];

  let failed = false;

  for (const [name, passed] of checks) {
    console.log(`${passed ? "PASS" : "FAIL"}: ${name}`);
    if (!passed) failed = true;
  }

  if (failed) {
    process.exitCode = 1;
    throw new Error("One or more page checks failed.");
  }

  console.log("Basic page smoke test passed.");
  console.log("Note: this does not test game controls or multiplayer.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
