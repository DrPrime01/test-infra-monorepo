#!/usr/bin/env node
import { exec } from "child_process";
import util from "util";

import * as p from "@clack/prompts";
import pc from "picocolors";

import { detectEnvironment, DetectedORM } from "./scanner.js";
import { generateStripeComponent } from "./generator.js";

// Convert callback-based exec to Promise-based so we can 'await' it
const execAsync = util.promisify(exec);

async function main() {
  // clear console and show header
  console.clear();
  p.intro(pc.bgCyan(pc.black("Welcome to Infra UI CLI")));

  const projectRoot = process.cwd();

  // 1. Run the Auto-detector spinner (UX)
  const s = p.spinner();
  s.start("Analysing your project structure...");

  const env = await detectEnvironment(projectRoot);
  await new Promise((resolve) => setTimeout(resolve, 800)); // Simulate some delay for better UX
  s.stop("Project analysis complete!");

  let chosenORM: DetectedORM | null = env.orm || null;

  // 2. Fallback menu if no ORM detected
  if ((env.orm = "UNKNOWN")) {
    (p.note(
      "We couldn't automatically detect your ORM.\n No worries! You can manually select your setup below",
    ),
      "Auto-Detection Failed");

    const selection = await p.select({
      message: "Which database ORM or tool are you using for this project?",
      options: [
        {
          value: "prisma",
          label: "Prisma",
          hint: "Pre-configures Prisma schema sync",
        },
        {
          value: "drizzle-orm",
          label: "Drizzle ORM",
          hint: "Pre-configures SQL dialect schema sync",
        },
        {
          value: "supabase",
          label: "Supabase Js",
          hint: "Pre-configures client-side or edge table sync",
        },
        { value: "typeorm", label: "TypeORM" },
        { value: "sequelize", label: "Sequelize" },
        { value: "mikro-orm", label: "MikroORM" },
        { value: "typeorm-legacy", label: "TypeORM (Legacy)" },
        { value: "objection", label: "Objection.js" },
        { value: "knex", label: "Knex.js" },
        { value: "typeorm-next", label: "TypeORM (Next)" },
        { value: "typeorm-legacy-next", label: "TypeORM (Legacy Next)" },
        {
          value: "manual",
          label: "None / Custom Setup",
          hint: "Gives you an empty boilerplate adapter to fill out yourself",
        },
      ],
    });

    // Hander user cancelling out via CTRL+C
    if (p.isCancel(selection)) {
      p.cancel("Installation aborted.");
      process.exit(0);
    }

    chosenORM = selection as DetectedORM;
  } else {
    p.log.success(`Detected ${pc.green(env.orm)} in your project!`);
  }

  // 3. Confirm installation target
  const confirmInstall = await p.confirm({
    message: `Ready to install the Stripe infra component into ${pc.cyan("./infra/stripe")}?`,
    initialValue: true,
  });

  if (p.isCancel(confirmInstall) || !confirmInstall) {
    p.cancel("Installation aborted.");
    process.exit(0);
  }

  // 4. Fire the file generation
  const installSpinner = p.spinner();
  installSpinner.start(
    `Injecting Stripe scaffolding tailored for ${chosenORM}...`,
  );

  try {
    // Calling the remote fetcher and writer
    const result = await generateStripeComponent(projectRoot, chosenORM!);
    installSpinner.stop(pc.green("Component successfully generated."));

    // (Optional) We can log dependencies they need to install
    if (result.dependencies && result.dependencies.length > 0) {
      const depSpinner = p.spinner();
      const depsToInstall = result.dependencies.join(" ");

      const pm = env.packageManager;
      let installCmd = "";

      if (pm === "npm") installCmd = `npm install ${depsToInstall} --silent`;
      if (pm === "pnpm") installCmd = `pnpm add ${depsToInstall} --silent`;
      if (pm === "bun") installCmd = `bun add ${depsToInstall} --silent`;
      if (pm === "yarn") installCmd = `yarn add ${depsToInstall} --silent`;

      depSpinner.start(
        `Installing required dependencies (${depsToInstall}). This might take a moment...`,
      );

      try {
        // Run npm install in the background inside the user's project folder
        await execAsync(installCmd, {
          cwd: projectRoot,
        });
        depSpinner.stop(pc.green("Dependencies installed successfully."));
      } catch (npmErr) {
        // Graceful fallback if the auto-install fails (e.g. network timeout)
        depSpinner.stop(pc.red("Auto-install failed."));
        const manualCmd = pm === "npm" ? `npm install` : `${pm} add`;
        p.note(
          `We couldn't install the dependencies automatically. Please run:\n${pc.cyan(manualCmd + ` ${depsToInstall}`)}`,
          "Manual Step Required",
        );
      }
    }
  } catch (error: any) {
    installSpinner.stop(pc.red("Failed to generate component."));
    p.cancel(`Error: ${error.message}`);
    process.exit(1);
  }

  // 5. Outro and Next steps

  p.outro(
    `🎉 ${pc.green("Stripe Infra Block added successfully!")}\n\n` +
      `${pc.bold("Next steps:")}\n` +
      ` 1. Add your ${pc.cyan("STRIPE_SECRET_KEY")} to your .env file.\n` +
      ` 2. Open ${pc.cyan("./infra/stripe/adapter.ts")} to verify your DB mapping.\n` +
      ` 3. Run your local dev server and test your webhooks!`,
  );

  main().catch((err) => {
    `🎉 ${pc.green("Stripe Infra Block added successfully!")}\n\n` +
      `${pc.bold("Next steps:")}\n` +
      ` 1. Add your ${pc.cyan("STRIPE_SECRET_KEY")} to your .env file.\n` +
      ` 2. Open ${pc.cyan("./infra/stripe/adapter.ts")} to verify your DB mapping.\n` +
      ` 3. Run your local dev server and test your webhooks!`;
  });
}
