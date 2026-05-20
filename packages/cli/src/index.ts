#!/usr/bin/env node
import { Command } from "commander";
import { exec } from "child_process";
import util from "util";
import fs from "fs-extra";
import path from "path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { detectEnvironment, DetectedORM } from "./scanner.js";
import { generateComponent } from "./generator.js";

const execAsync = util.promisify(exec);
const program = new Command();

program
  .name("infra-ui")
  .description("Add critical infrastructure components to your app")
  .version("0.1.0");

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

    // 1. Check if config already exists
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

    // 2. Scan the environment
    const s = p.spinner();
    s.start("Scanning your project structure...");
    const env = await detectEnvironment(projectRoot);
    await new Promise((resolve) => setTimeout(resolve, 800));
    s.stop("Project analysis complete!");

    let chosenORM: DetectedORM | null = env.orm || null;

    // 3. Fallback menu if scanning fails
    if (env.orm === "UNKNOWN") {
      const selection = await p.select({
        message: "Which database ORM or tool are you using?",
        options: [
          { value: "prisma", label: "Prisma" },
          { value: "drizzle-orm", label: "Drizzle ORM" },
          { value: "supabase", label: "Supabase JS" },
          { value: "manual", label: "None / Custom Setup" },
        ],
      });

      if (p.isCancel(selection)) {
        p.cancel("Aborted.");
        process.exit(0);
      }
      chosenORM = selection as DetectedORM;
    }

    // 4. Save the configuration
    const config = {
      packageManager: env.packageManager,
      orm: chosenORM,
      basePath: env.basePath,
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
    const supported = ["stripe", "resend", "twilio"];
    if (!supported.includes(component)) {
      p.log.error(`Component "${component}" is not supported yet.`);
      p.log.info(`Available components: ${supported.join(", ")}`);
      process.exit(1);
    }

    console.clear();
    p.intro(pc.bgCyan(pc.black(` Installing ${component} `)));

    const projectRoot = process.cwd();
    const configPath = path.join(projectRoot, "infra.json");

    // 1. Enforce the config file requirement
    if (!(await fs.pathExists(configPath))) {
      p.log.error(
        `Configuration file missing. Please run ${pc.green("npx infra-ui init")} first.`,
      );
      process.exit(1);
    }

    // 2. Read preferences from infra.json
    const config = await fs.readJson(configPath);
    const chosenORM = config.orm as DetectedORM;
    const pm = config.packageManager || "npm";

    // 3. Confirm target directory
    const confirmInstall = await p.confirm({
      message: `Install ${pc.green(component)} into ${pc.cyan("./infra/" + component)}?`,
      initialValue: true,
    });

    if (p.isCancel(confirmInstall) || !confirmInstall) {
      p.cancel("Aborted.");
      process.exit(0);
    }

    const targetDir = path.join(
      projectRoot,
      config.basePath || "",
      "infra",
      component,
    );

    // If the folder already exists, warn the user!
    if (await fs.pathExists(targetDir)) {
      p.log.warn(
        `The ${pc.yellow(component)} component already exists in your project.`,
      );

      const overwrite = await p.confirm({
        message: pc.red(
          "Do you want to overwrite it? All custom changes will be lost!",
        ),
        initialValue: false, // Default to NO for safety
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Installation safely aborted. Your files were not changed.");
        process.exit(0);
      }
    }

    // 4. Generate the component
    const installSpinner = p.spinner();
    installSpinner.start(`Generating files tailored for ${chosenORM}...`);

    try {
      const result = await generateComponent(projectRoot, chosenORM, component);
      installSpinner.stop(pc.green("Files generated."));

      // 5. Install dependencies
      if (result.dependencies && result.dependencies.length > 0) {
        const depSpinner = p.spinner();
        const depsToInstall = result.dependencies.join(" ");

        let installCmd = `${pm} install ${depsToInstall} --silent`;
        if (pm === "yarn" || pm === "pnpm" || pm === "bun") {
          installCmd = `${pm} add ${depsToInstall} --silent`;
        }

        depSpinner.start(`Installing dependencies via ${pm}...`);
        await execAsync(installCmd, { cwd: projectRoot });
        depSpinner.stop(pc.green("Dependencies installed."));
      }
    } catch (error: any) {
      installSpinner.stop(pc.red("Failed."));
      p.cancel(error.message);
      process.exit(1);
    }

    p.outro(`🎉 ${pc.green(`${component} added successfully!`)}`);
  });

// Execute Commander
program.parse(process.argv);
