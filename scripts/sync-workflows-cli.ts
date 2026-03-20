import { syncWorkflows } from "./sync-workflows";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");
const TEMPLATE_PATH = join(ROOT, "templates", "workflow.netlify.template.yml");

// ANSI colors
const blue = "\x1b[34m";
const green = "\x1b[32m";
const gray = "\x1b[90m";
const reset = "\x1b[0m";

async function main() {
  const acceptAll = process.argv.includes("--accept-all");
  const acceptAllExplicit = acceptAll ? true : undefined;

  console.log(`\n${blue}🔄 Syncing workflows with template...${reset}\n`);

  const { updated, skipped } = await syncWorkflows(
    WORKFLOWS_DIR,
    TEMPLATE_PATH,
    acceptAllExplicit,
  );

  console.log("");

  if (updated === 0 && skipped === 0) {
    console.log(`${green}✨ All workflows are in sync with the template${reset}`);
  } else {
    if (updated > 0) {
      console.log(`${green}[sync-workflows] ${updated} updated${reset}`);
    }
    if (skipped > 0) {
      console.log(`${gray}[sync-workflows] ${skipped} skipped${reset}`);
    }
  }

  console.log("");

  process.exit(0);
}

main().catch((error) => {
  console.error("[sync-workflows] error:", (error as Error).message);
  process.exit(1);
});
