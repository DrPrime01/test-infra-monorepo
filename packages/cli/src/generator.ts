import fs from "fs-extra";
import path from "path";
import { DetectedORM } from "./scanner.js";

export interface ComponentOptions {
  providers?: string[];
  env: Record<string, string>;
  isAppRouter?: boolean;
}

const providerCasing: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
  discord: "Discord",
};

// TODO: Before v1.0, pin REGISTRY_BASE to a versioned tag (refs/tags/vX.Y.Z)
// and add per-file SHA-256 integrity verification to prevent supply chain attacks.
const REGISTRY_BASE =
  "https://raw.githubusercontent.com/DrPrime01/test-infra-monorepo/refs/heads/main/packages/registry";

export async function generateComponent(
  projectRoot: string,
  orm: DetectedORM,
  component: string,
  options?: ComponentOptions,
) {
  const response = await fetch(`${REGISTRY_BASE}/${component}.json`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch component registry. Status: ${response.status}`,
    );
  }

  const payload = await response.json();

  const hasSrcDirectory = await fs.pathExists(path.join(projectRoot, "src"));
  const baseDir = hasSrcDirectory ? "src" : "";
  const rootTargetDir = path.join(projectRoot, baseDir);

  // authjs files live under infra/auth/ so auth.ts can import "./infra/auth/adapter"
  const infraComponentName = component === "authjs" ? "auth" : component;
  const infraDir = path.join(projectRoot, baseDir, "infra", infraComponentName);

  // Default isAppRouter to true — App Router is the modern default
  const isAppRouter = options?.isAppRouter ?? true;

  const writePromises: Promise<void>[] = [];

  if (payload.files) {
    for (const [fileName, content] of Object.entries(payload.files)) {
      let fileContent = content as string;

      // Files with path separators are routed to rootTargetDir.
      // Filter by router type so only relevant files are written.
      if (fileName.includes("/")) {
        if (fileName.startsWith("app/") && !isAppRouter) continue;
        if (fileName.startsWith("pages/") && isAppRouter) continue;
        writePromises.push(
          fs.outputFile(path.join(rootTargetDir, fileName), fileContent),
        );
        continue;
      }

      // Simple filename handling (no path separators)
      if (fileName === "auth.ts" && component === "authjs") {
        let imports = "";
        let array = "";
        const providers = options?.providers ?? [];
        providers.forEach((p: string) => {
          const properName = providerCasing[p] ?? p;
          imports += `import ${properName} from "next-auth/providers/${p}";\n`;
          array += `    ${properName},\n`;
        });
        fileContent = fileContent
          .replace("{{PROVIDER_IMPORTS}}", imports.trim())
          .replace("{{PROVIDER_ARRAY}}", array.trimEnd());
        writePromises.push(
          fs.outputFile(path.join(rootTargetDir, fileName), fileContent),
        );
      } else if (fileName === "route.ts" && component === "authjs") {
        const apiDir = path.join(
          projectRoot,
          baseDir,
          "app",
          "api",
          "auth",
          "[...nextauth]",
        );
        writePromises.push(fs.outputFile(path.join(apiDir, fileName), fileContent));
      } else if (fileName === "route.ts") {
        const apiDir = path.join(
          projectRoot,
          baseDir,
          "app",
          "api",
          "webhooks",
          component,
        );
        writePromises.push(fs.outputFile(path.join(apiDir, fileName), fileContent));
      } else {
        writePromises.push(fs.outputFile(path.join(infraDir, fileName), fileContent));
      }
    }
  }

  if (payload.adapters) {
    const adapterContent = payload.adapters[orm] ?? payload.adapters["manual"];
    writePromises.push(fs.outputFile(path.join(infraDir, "adapter.ts"), adapterContent));
  }

  await Promise.all(writePromises);

  // Process middleware templates for any component that defines them
  if (payload.middlewareTemplates) {
    let nextVersion = 15;
    try {
      const userPkg = await fs.readJson(path.join(projectRoot, "package.json"));
      const rawVersion =
        userPkg.dependencies?.next ?? userPkg.devDependencies?.next ?? "15.0.0";
      const cleanVersion = rawVersion.replace(/[^0-9.]/g, "");
      nextVersion = parseInt(cleanVersion.split(".")[0], 10);
    } catch {
      /* default to 15 safely */
    }

    const isNext16 = nextVersion >= 16;
    const interceptorFileName = isNext16 ? "proxy.ts" : "middleware.ts";
    const interceptorPath = path.join(rootTargetDir, interceptorFileName);
    const templateKey = isNext16 ? "proxy" : "legacy";
    const baseTemplate = payload.middlewareTemplates[templateKey];

    if (await fs.pathExists(interceptorPath)) {
      const existingContent = await fs.readFile(interceptorPath, "utf-8");
      if (component === "authjs" && !existingContent.includes('from "./auth"')) {
        await fs.outputFile(
          interceptorPath,
          `import { auth } from "./auth";\n${existingContent}`,
        );
      } else if (
        component === "clerk" &&
        !existingContent.includes("clerkMiddleware")
      ) {
        // Clerk middleware cannot be safely merged with an existing file — overwrite
        await fs.outputFile(interceptorPath, baseTemplate);
      }
    } else {
      await fs.outputFile(interceptorPath, baseTemplate);
    }
  }

  // Write env vars for any component that provides them — always to .env.local
  if (options?.env && Object.keys(options.env).length > 0) {
    const envLocalPath = path.join(projectRoot, ".env.local");

    let envContent = "";
    if (await fs.pathExists(envLocalPath)) {
      envContent = await fs.readFile(envLocalPath, "utf-8");
      if (!envContent.endsWith("\n")) envContent += "\n";
    } else {
      envContent = "# Make sure this file is listed in your .gitignore!\n";
    }

    const sectionHeaders: Record<string, string> = {
      authjs: "# Auth.js Configuration",
      clerk: "# Clerk Configuration",
      twilio: "# Twilio Configuration",
      paystack: "# Paystack Configuration",
    };
    envContent += `\n${sectionHeaders[component] ?? `# ${component} Configuration`}\n`;

    for (const [key, value] of Object.entries(options.env)) {
      envContent += `${key}="${value ?? ""}"\n`;
    }

    await fs.outputFile(envLocalPath, envContent);
  }

  return {
    dependencies: payload.dependencies ?? [],
  };
}
