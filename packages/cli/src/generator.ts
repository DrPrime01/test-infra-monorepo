import fs from "fs-extra";
import path from "path";
import { DetectedORM } from "./scanner.js";

const REGISTRY_URL =
  "https://raw.githubusercontent.com/your-username/infra-ui-registry/main/stripe.json";

export async function generateStripeComponent(
  projectRoot: string,
  orm: DetectedORM,
) {
  // 1. Fetch the remote payload
  const response = await fetch(REGISTRY_URL);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch component registry. Status: ${response.status}`,
    );
  }

  const payload = await response.json();

  // 2. Determine where to write the files (Supports both src/ and root app/)
  const hasSrcDirectory = await fs.pathExists(path.join(projectRoot, "src"));
  const baseDir = hasSrcDirectory ? "src" : "";

  // set target folders
  const infraDir = path.join(projectRoot, baseDir, "infra", "stripe");
  const apiDir = path.join(
    projectRoot,
    baseDir,
    "app",
    "api",
    "webhooks",
    "stripe",
  );

  // 3. Create the directories if they don't exist
  await fs.ensureDir(infraDir);
  await fs.ensureDir(apiDir);

  // 4. Write the files to the target locations
  const filesToWrite = [
    {
      name: "client.ts",
      content: payload.files["client.ts"],
      dir: infraDir,
    },
    {
      name: "actions.ts",
      content: payload.files["actions.ts"],
      dir: infraDir,
    },
    {
      name: "webhooks.ts",
      content: payload.files["webhooks.ts"],
      dir: infraDir,
    },
    { name: "route.ts", content: payload.files["route.ts"], dir: apiDir },
  ];

  for (const file of filesToWrite) {
    await fs.outputFile(path.join(file.dir, file.name), file.content);
  }

  // 5. Inject the Smart Adapter based on the detected ORM
  // Fallback to manual if we don't have a specific snippet for their ORM
  const adapterContent = payload.adapters[orm] || payload.adapters["manual"];

  await fs.outputFile(path.join(infraDir, "adapter.ts"), adapterContent);

  return {
    dependencies: payload.dependencies || [],
  };
}
