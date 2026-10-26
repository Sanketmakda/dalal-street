
const baseUrl = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  console.log(`Testing server at ${baseUrl}`);

  const response = await fetch(baseUrl);
  console.log("HTTP status:", response.status);

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }

  const html = await response.text();

  if (!html.includes("<html") && !html.includes("<!DOCTYPE html")) {
    throw new Error("Response does not appear to be an HTML page");
  }

  console.log("Basic HTTP and HTML check passed.");
}

main().catch((error) => {
  console.error("Test failed:", error.message);
  process.exitCode = 1;
});
