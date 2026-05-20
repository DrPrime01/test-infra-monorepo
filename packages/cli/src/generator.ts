import fs from "fs-extra";
import path from "path";
import { DetectedORM } from "./scanner.js";

export async function generateComponent(
  projectRoot: string,
  orm: DetectedORM,
  component: string,
) {
  const REGISTRY_URL = `https://raw.githubusercontent.com/DrPrime01/test-infra-monorepo/refs/heads/main/packages/registry/${component}.json`;
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
  const infraDir = path.join(projectRoot, baseDir, "infra", component);
  const apiDir = path.join(
    projectRoot,
    baseDir,
    "app",
    "api",
    "webhooks",
    component,
  );

  // 3. Create the directories if they don't exist
  await fs.ensureDir(infraDir);
  await fs.ensureDir(apiDir);

  // 4. Write the files to the target locations
  const filesToWrite: { name: string; content: string; dir: string }[] =
    Object.entries(payload.files).map(([filename, content]) => ({
      name: filename,
      content: content as string,
      dir: filename === "route.ts" ? apiDir : infraDir,
    }));

  for (const file of filesToWrite) {
    await fs.outputFile(path.join(file.dir, file.name), file.content);
  }

  // 5. Inject the Smart Adapter based on the detected ORM if the component requires one
  // Fallback to manual if we don't have a specific snippet for their ORM
  if (payload.adapters) {
    const adapterContent = payload.adapters[orm] || payload.adapters["manual"];
    await fs.outputFile(path.join(infraDir, "adapter.ts"), adapterContent);
  }

  return {
    dependencies: payload.dependencies || [],
  };
}
