#!/usr/bin/env node
import { Command } from "commander";
import { execFile } from "child_process";
import util from "util";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { detectEnvironment, DetectedORM, PackageManager } from "./scanner.js";
import { generateComponent, ComponentOptions } from "./generator.js";

const execFileAsync = util.promisify(execFile);
const program = new Command();

program
  .name("infra-ui")
  .description("Add critical infrastructure components to your app")
  .version("0.1.0");

const VALID_PACKAGE_MANAGERS: readonly PackageManager[] = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
];

const VALID_ORM_VALUES: readonly string[] = [
  "prisma",
  "drizzle-orm",
  "sequelize",
  "typeorm",
  "mikro-orm",
  "typeorm-legacy",
  "objection",
  "knex",
  "typeorm-next",
  "typeorm-legacy-next",
  "manual",
  "UNKNOWN",
];

// Only allow characters that are valid in npm package names
const VALID_DEP_RE = /^[@a-zA-Z0-9][a-zA-Z0-9._@/\-]*$/;

function validateConfig(raw: unknown): {
  packageManager: PackageManager;
  orm: DetectedORM;
  basePath: string;
  isAppRouter: boolean;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("infra.json is malformed — expected a JSON object.");
  }
  const c = raw as Record<string, unknown>;

  if (!VALID_PACKAGE_MANAGERS.includes(c.packageManager as PackageManager)) {
    throw new Error(
      `Invalid packageManager "${c.packageManager}" in infra.json. Must be one of: ${VALID_PACKAGE_MANAGERS.join(", ")}.`,
    );
  }
  if (!VALID_ORM_VALUES.includes(c.orm as string)) {
    throw new Error(`Invalid orm "${c.orm}" in infra.json.`);
  }
  if (typeof c.basePath !== "string") {
    throw new Error("Invalid basePath in infra.json — must be a string.");
  }

  return {
    packageManager: c.packageManager as PackageManager,
    orm: c.orm as DetectedORM,
    basePath: c.basePath,
    // Default to true for backward compat with infra.json files that predate this field
    isAppRouter: typeof c.isAppRouter === "boolean" ? c.isAppRouter : true,
  };
}

// ==========================================
// COMMAND: INIT
// ==========================================
program
  .command("init")
  .description("Initialize configuration and setup infra.json")
  .action(async () => {
    console.clear();
    p.intro(pc.bgCyan(pc.black(" infra-ui init ")));

    const projectRoot = process.cwd();
    const configPath = path.join(projectRoot, "infra.json");

    if (await fs.pathExists(configPath)) {
      const overwrite = await p.confirm({
        message:
          "An infra.json file already exists. Do you want to overwrite it?",
        initialValue: false,
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Initialization aborted.");
        process.exit(0);
      }
    }

    const s = p.spinner();
    s.start("Scanning your project structure...");
    const env = await detectEnvironment(projectRoot);
    s.stop("Project analysis complete!");

    let chosenORM: DetectedORM | null = env.orm || null;

    if (env.orm === "UNKNOWN") {
      const selection = await p.select({
        message: "Which database ORM or tool are you using?",
        options: [
          { value: "prisma", label: "Prisma" },
          { value: "drizzle-orm", label: "Drizzle ORM" },
          { value: "manual", label: "None / Custom Setup" },
        ],
      });

      if (p.isCancel(selection)) {
        p.cancel("Aborted.");
        process.exit(0);
      }
      chosenORM = selection as DetectedORM;
    }

    const config = {
      packageManager: env.packageManager,
      orm: chosenORM,
      basePath: env.basePath,
      isAppRouter: env.isAppRouter,
    };

    await fs.outputJson(configPath, config, { spaces: 2 });

    p.outro(
      `🎉 ${pc.green("Success!")} Created ${pc.cyan("infra.json")} at the root of your project.`,
    );
  });

// ==========================================
// COMMAND: ADD
// ==========================================
program
  .command("add <component>")
  .description("Add a new infrastructure component to your project")
  .action(async (component: string) => {
    const supported = ["stripe", "resend", "twilio", "authjs", "clerk"];
    if (!supported.includes(component)) {
      p.log.error(`Component "${component}" is not supported yet.`);
      p.log.info(`Available components: ${supported.join(", ")}`);
      process.exit(1);
    }

    console.clear();
    p.intro(pc.bgCyan(pc.black(` Installing ${component} `)));

    const projectRoot = process.cwd();
    const configPath = path.join(projectRoot, "infra.json");

    if (!(await fs.pathExists(configPath))) {
      p.log.error(
        `Configuration file missing. Please run ${pc.green("npx infra-ui init")} first.`,
      );
      process.exit(1);
    }

    let config: ReturnType<typeof validateConfig>;
    try {
      config = validateConfig(await fs.readJson(configPath));
    } catch (err: unknown) {
      p.log.error(
        err instanceof Error ? err.message : "Failed to read infra.json.",
      );
      process.exit(1);
    }

    const { orm: chosenORM, packageManager: pm, basePath, isAppRouter } = config;

    const componentOptions: ComponentOptions = {
      providers: [],
      env: {},
      isAppRouter,
    };

    // --- AUTH.JS PROVIDER PROMPTING ---
    if (component === "authjs") {
      const providerSelection = await p.multiselect({
        message: "Which authentication providers do you want to configure?",
        options: [
          { value: "google", label: "Google" },
          { value: "github", label: "GitHub" },
          { value: "facebook", label: "Facebook" },
          { value: "discord", label: "Discord" },
        ],
        required: false,
      });

      if (p.isCancel(providerSelection)) {
        p.cancel("Aborted.");
        process.exit(0);
      }

      componentOptions.providers = providerSelection as string[];

      if (componentOptions.providers.length > 0) {
        p.note(
          "Provide your OAuth keys below. Leave blank to generate empty placeholders in your .env.local file.",
        );

        for (const provider of componentOptions.providers) {
          const clientId = await p.text({
            message: `${provider.toUpperCase()} Client ID:`,
            placeholder: `Enter your ${provider} client ID...`,
          });
          if (p.isCancel(clientId)) process.exit(0);

          const clientSecret = await p.text({
            message: `${provider.toUpperCase()} Client Secret:`,
            placeholder: `Enter your ${provider} client secret...`,
          });
          if (p.isCancel(clientSecret)) process.exit(0);

          componentOptions.env[`AUTH_${provider.toUpperCase()}_ID`] =
            clientId as string;
          componentOptions.env[`AUTH_${provider.toUpperCase()}_SECRET`] =
            clientSecret as string;
        }
      }

      p.note("Generating a secure AUTH_SECRET automatically...", "Security");
      componentOptions.env["AUTH_SECRET"] = crypto
        .randomBytes(32)
        .toString("base64");
    }
    // ------------------------------------

    // --- CLERK KEY PROMPTING ---
    if (component === "clerk") {
      p.note("Provide your Clerk API keys from the Clerk dashboard.");

      const publishableKey = await p.text({
        message: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:",
        placeholder: "pk_test_...",
      });
      if (p.isCancel(publishableKey)) process.exit(0);

      const secretKey = await p.text({
        message: "CLERK_SECRET_KEY:",
        placeholder: "sk_test_...",
      });
      if (p.isCancel(secretKey)) process.exit(0);

      componentOptions.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"] =
        publishableKey as string;
      componentOptions.env["CLERK_SECRET_KEY"] = secretKey as string;
      // Placeholder so the app boots locally before the webhook is configured
      componentOptions.env["CLERK_WEBHOOK_SECRET"] =
        "whsec_YOUR_WEBHOOK_SECRET_HERE";
    }
    // ---------------------------

    // authjs files are written into infra/auth/ — show the real path
    const displayComponent = component === "authjs" ? "auth" : component;

    const confirmInstall = await p.confirm({
      message: `Install ${pc.green(component)} into ${pc.cyan("./infra/" + displayComponent)}?`,
      initialValue: true,
    });

    if (p.isCancel(confirmInstall) || !confirmInstall) {
      p.cancel("Aborted.");
      process.exit(0);
    }

    const targetDir = path.join(
      projectRoot,
      basePath || "",
      "infra",
      displayComponent,
    );

    if (await fs.pathExists(targetDir)) {
      p.log.warn(
        `The ${pc.yellow(component)} component already exists in your project.`,
      );

      const overwrite = await p.confirm({
        message: pc.red(
          "Do you want to overwrite it? All custom changes will be lost!",
        ),
        initialValue: false,
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Installation safely aborted. Your files were not changed.");
        process.exit(0);
      }
    }

    const installSpinner = p.spinner();
    installSpinner.start(`Generating files tailored for ${chosenORM}...`);

    try {
      const result = await generateComponent(
        projectRoot,
        chosenORM,
        component,
        componentOptions,
      );
      installSpinner.stop(pc.green("Files generated."));

      // Only inject adapters that actually exist in the @auth/* namespace
      const AUTH_ADAPTER_SUPPORTED_ORMS = ["prisma", "drizzle-orm"];
      if (
        component === "authjs" &&
        AUTH_ADAPTER_SUPPORTED_ORMS.includes(chosenORM)
      ) {
        result.dependencies.push(`@auth/${chosenORM}-adapter`);
      }

      // Pages Router Clerk needs micro for raw body parsing in the webhook
      if (component === "clerk" && !isAppRouter) {
        result.dependencies.push("micro");
      }

      if (result.dependencies && result.dependencies.length > 0) {
        // Validate every dependency name before passing to execFile — prevents
        // a compromised registry from injecting arbitrary shell commands
        const safeDeps = result.dependencies.filter((d: string) =>
          VALID_DEP_RE.test(d),
        );
        if (safeDeps.length !== result.dependencies.length) {
          throw new Error(
            "Registry returned one or more invalid dependency names. Aborting.",
          );
        }

        const depSpinner = p.spinner();
        const installArgs =
          pm === "npm"
            ? ["install", ...safeDeps, "--silent"]
            : ["add", ...safeDeps, "--silent"];

        depSpinner.start(`Installing dependencies via ${pm}...`);
        // execFile — no shell spawned, so no shell injection possible
        await execFileAsync(pm, installArgs, { cwd: projectRoot });
        depSpinner.stop(pc.green("Dependencies installed."));
      }
    } catch (error: unknown) {
      installSpinner.stop(pc.red("Failed."));
      p.cancel(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    p.outro(`🎉 ${pc.green(`${component} added successfully!`)}`);
  });

program.parse(process.argv);
