#!/usr/bin/env node
import { Command } from "commander";
import { execFile } from "child_process";
import util from "util";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { detectEnvironment } from "./scanner.js";
import { generateComponent } from "./generator.js";
const execFileAsync = util.promisify(execFile);
const program = new Command();
program
    .name("infra-ui")
    .description("Add critical infrastructure components to your app")
    .version("0.1.0");
const VALID_PACKAGE_MANAGERS = [
    "npm",
    "pnpm",
    "yarn",
    "bun",
];
const VALID_ORM_VALUES = [
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
// Component names go into a URL path; lock down to a tight character set so a
// compromised manifest can't redirect fetches via slashes/dots/encodings.
const VALID_COMPONENT_RE = /^[a-z][a-z0-9-]*$/;
// Helper: require non-empty trimmed input for `p.text` / `p.password`.
const required = (label) => (v) => !v || v.trim().length === 0 ? `${label} is required` : undefined;
function validateConfig(raw, projectRoot) {
    if (!raw || typeof raw !== "object") {
        throw new Error("infra.json is malformed — expected a JSON object.");
    }
    const c = raw;
    if (!VALID_PACKAGE_MANAGERS.includes(c.packageManager)) {
        throw new Error(`Invalid packageManager "${c.packageManager}" in infra.json. Must be one of: ${VALID_PACKAGE_MANAGERS.join(", ")}.`);
    }
    if (!VALID_ORM_VALUES.includes(c.orm)) {
        throw new Error(`Invalid orm "${c.orm}" in infra.json.`);
    }
    if (typeof c.basePath !== "string") {
        throw new Error("Invalid basePath in infra.json — must be a string.");
    }
    // basePath must stay inside the project — block absolute paths and traversal
    if (path.isAbsolute(c.basePath)) {
        throw new Error("basePath in infra.json must be relative, not absolute.");
    }
    const resolvedBase = path.resolve(projectRoot, c.basePath);
    const resolvedRoot = path.resolve(projectRoot);
    if (resolvedBase !== resolvedRoot &&
        !resolvedBase.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`basePath in infra.json escapes the project root: "${c.basePath}".`);
    }
    return {
        packageManager: c.packageManager,
        orm: c.orm,
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
            message: "An infra.json file already exists. Do you want to overwrite it?",
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
    let chosenORM = env.orm || null;
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
        chosenORM = selection;
    }
    const config = {
        packageManager: env.packageManager,
        orm: chosenORM,
        basePath: env.basePath,
        isAppRouter: env.isAppRouter,
    };
    await fs.outputJson(configPath, config, { spaces: 2 });
    p.outro(`🎉 ${pc.green("Success!")} Created ${pc.cyan("infra.json")} at the root of your project.`);
});
// Fetch the registry manifest to learn which components are available.
// Falls back to a baked-in list if the network is unavailable.
const FALLBACK_COMPONENTS = [
    "stripe",
    "resend",
    "twilio",
    "authjs",
    "clerk",
    "paystack",
];
const REGISTRY_MANIFEST_URL = `${process.env.INFRA_REGISTRY_BASE ?? "https://raw.githubusercontent.com/DrPrime01/test-infra-monorepo/refs/heads/main/packages/registry"}/manifest.json`;
async function getSupportedComponents() {
    try {
        const res = await fetch(REGISTRY_MANIFEST_URL, {
            signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok)
            throw new Error(`status ${res.status}`);
        const manifest = (await res.json());
        const names = manifest.components?.map((c) => c.name) ?? [];
        return names.length > 0 ? names : FALLBACK_COMPONENTS;
    }
    catch {
        return FALLBACK_COMPONENTS;
    }
}
// ==========================================
// COMMAND: ADD
// ==========================================
program
    .command("add <component>")
    .description("Add a new infrastructure component to your project")
    .action(async (component) => {
    // Defense in depth: even if the manifest somehow lists weird names,
    // refuse to fetch anything that isn't a plain `[a-z][a-z0-9-]*` token.
    if (!VALID_COMPONENT_RE.test(component)) {
        p.log.error(`Component name "${component}" is invalid. Use lowercase letters, digits, and hyphens.`);
        process.exit(1);
    }
    const supported = await getSupportedComponents();
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
        p.log.error(`Configuration file missing. Please run ${pc.green("npx infra-ui init")} first.`);
        process.exit(1);
    }
    let config;
    try {
        config = validateConfig(await fs.readJson(configPath), projectRoot);
    }
    catch (err) {
        p.log.error(err instanceof Error ? err.message : "Failed to read infra.json.");
        process.exit(1);
    }
    const { orm: chosenORM, packageManager: pm, basePath, isAppRouter } = config;
    // Cross-check infra.json against actual project state — warn (don't abort)
    // on drift so users notice if they hand-edited the config out of sync
    try {
        const env = await detectEnvironment(projectRoot);
        if (env.orm !== "UNKNOWN" && env.orm !== chosenORM) {
            p.log.warn(`infra.json says orm="${chosenORM}" but project has "${env.orm}". Generated adapters may not work.`);
        }
        if (env.packageManager !== pm) {
            p.log.warn(`infra.json says packageManager="${pm}" but project lockfile suggests "${env.packageManager}".`);
        }
        if (env.isAppRouter !== isAppRouter) {
            p.log.warn(`infra.json says isAppRouter=${isAppRouter} but project looks like ${env.isAppRouter ? "App Router" : "Pages Router"}.`);
        }
    }
    catch {
        /* scanner failure shouldn't block install */
    }
    const componentOptions = {
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
        componentOptions.providers = providerSelection;
        if (componentOptions.providers.length > 0) {
            p.note("Provide your OAuth keys below. Leave blank to generate empty placeholders in your .env.local file.");
            for (const provider of componentOptions.providers) {
                const clientId = await p.text({
                    message: `${provider.toUpperCase()} Client ID:`,
                    placeholder: `Enter your ${provider} client ID...`,
                    validate: required(`${provider} client ID`),
                });
                if (p.isCancel(clientId))
                    process.exit(0);
                // OAuth client secrets are sensitive — mask input.
                const clientSecret = await p.password({
                    message: `${provider.toUpperCase()} Client Secret:`,
                    validate: required(`${provider} client secret`),
                });
                if (p.isCancel(clientSecret))
                    process.exit(0);
                componentOptions.env[`AUTH_${provider.toUpperCase()}_ID`] =
                    clientId;
                componentOptions.env[`AUTH_${provider.toUpperCase()}_SECRET`] =
                    clientSecret;
            }
        }
        p.note("Generating a secure AUTH_SECRET automatically...", "Security");
        // base64url avoids `/` and `+` that can confuse some env-file parsers.
        componentOptions.env["AUTH_SECRET"] = crypto
            .randomBytes(32)
            .toString("base64url");
    }
    // ------------------------------------
    // --- CLERK KEY PROMPTING ---
    if (component === "clerk") {
        p.note("Provide your Clerk API keys from the Clerk dashboard.");
        // Publishable key is `NEXT_PUBLIC_*` — designed to ship to the browser,
        // so plain text input is fine (and lets the user spot-check the pasted value).
        const publishableKey = await p.text({
            message: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:",
            placeholder: "pk_test_...",
            validate: required("Publishable key"),
        });
        if (p.isCancel(publishableKey))
            process.exit(0);
        const secretKey = await p.password({
            message: "CLERK_SECRET_KEY:",
            validate: required("Secret key"),
        });
        if (p.isCancel(secretKey))
            process.exit(0);
        // Webhook secret is created later in the Clerk dashboard. Allow blank;
        // emit a loud warning so the user knows to fill it in before deploy.
        const webhookSecret = await p.password({
            message: "CLERK_WEBHOOK_SECRET (optional — leave blank to fill in later):",
        });
        if (p.isCancel(webhookSecret))
            process.exit(0);
        componentOptions.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"] =
            publishableKey;
        componentOptions.env["CLERK_SECRET_KEY"] = secretKey;
        const ws = webhookSecret?.trim() ?? "";
        if (ws.length > 0) {
            componentOptions.env["CLERK_WEBHOOK_SECRET"] = ws;
        }
        else {
            componentOptions.env["CLERK_WEBHOOK_SECRET"] =
                "whsec_REPLACE_ME_BEFORE_DEPLOY";
            p.log.warn("CLERK_WEBHOOK_SECRET left blank — replace the placeholder in .env.local before deploying, or webhook verification will fail.");
        }
    }
    // ---------------------------
    // --- RESEND KEY PROMPTING ---
    if (component === "resend") {
        p.note("Provide your Resend credentials from resend.com/api-keys.");
        const apiKey = await p.password({
            message: "RESEND_API_KEY:",
            validate: required("API key"),
        });
        if (p.isCancel(apiKey))
            process.exit(0);
        const fromEmail = await p.text({
            message: "RESEND_FROM_EMAIL (verified sender, e.g. \"Acme <hi@acme.dev>\"):",
            placeholder: "Acme <onboarding@resend.dev>",
            validate: required("From email"),
        });
        if (p.isCancel(fromEmail))
            process.exit(0);
        componentOptions.env["RESEND_API_KEY"] = apiKey;
        componentOptions.env["RESEND_FROM_EMAIL"] = fromEmail;
    }
    // ----------------------------
    // --- TWILIO KEY PROMPTING ---
    if (component === "twilio") {
        p.note("Provide your Twilio credentials from the Twilio Console (console.twilio.com).");
        const accountSid = await p.text({
            message: "TWILIO_ACCOUNT_SID:",
            placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            validate: required("Account SID"),
        });
        if (p.isCancel(accountSid))
            process.exit(0);
        const authToken = await p.password({
            message: "TWILIO_AUTH_TOKEN:",
            validate: required("Auth token"),
        });
        if (p.isCancel(authToken))
            process.exit(0);
        const phoneNumber = await p.text({
            message: "TWILIO_PHONE_NUMBER (your Twilio number, E.164 format):",
            placeholder: "+12345678900",
            validate: required("Phone number"),
        });
        if (p.isCancel(phoneNumber))
            process.exit(0);
        // Optional — empty allowed (skip 2FA).
        const verifyServiceSid = await p.text({
            message: "TWILIO_VERIFY_SERVICE_SID (leave blank to skip 2FA / Verify):",
            placeholder: "VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        });
        if (p.isCancel(verifyServiceSid))
            process.exit(0);
        componentOptions.env["TWILIO_ACCOUNT_SID"] = accountSid;
        componentOptions.env["TWILIO_AUTH_TOKEN"] = authToken;
        componentOptions.env["TWILIO_PHONE_NUMBER"] = phoneNumber;
        if (verifyServiceSid.trim()) {
            componentOptions.env["TWILIO_VERIFY_SERVICE_SID"] =
                verifyServiceSid;
        }
    }
    // ----------------------------
    // --- PAYSTACK KEY PROMPTING ---
    if (component === "paystack") {
        p.note("Provide your Paystack API keys from the Paystack dashboard.");
        const secretKey = await p.password({
            message: "PAYSTACK_SECRET_KEY:",
            validate: required("Secret key"),
        });
        if (p.isCancel(secretKey))
            process.exit(0);
        // Public key is `NEXT_PUBLIC_*` — visible to the browser by design.
        const publicKey = await p.text({
            message: "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY:",
            placeholder: "pk_test_...",
            validate: required("Public key"),
        });
        if (p.isCancel(publicKey))
            process.exit(0);
        componentOptions.env["PAYSTACK_SECRET_KEY"] = secretKey;
        componentOptions.env["NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY"] = publicKey;
    }
    // ------------------------------
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
    const targetDir = path.join(projectRoot, basePath || "", "infra", displayComponent);
    if (await fs.pathExists(targetDir)) {
        p.log.warn(`The ${pc.yellow(component)} component already exists in your project.`);
        const overwrite = await p.confirm({
            // Be honest about scope: only `infra/<component>/` is what we check
            // for. Routes (`app/api/webhooks/<component>/route.ts`), middleware,
            // and `.env.local` are always overwritten/merged regardless.
            message: pc.red(`Overwrite ./infra/${displayComponent}/? Other generated files (webhook routes, middleware, .env.local) will be re-written either way.`),
            initialValue: false,
        });
        if (p.isCancel(overwrite) || !overwrite) {
            p.cancel("Installation safely aborted. Your files were not changed.");
            process.exit(0);
        }
    }
    const installSpinner = p.spinner();
    installSpinner.start(`Generating files tailored for ${chosenORM}...`);
    // Track spinner liveness so the catch block doesn't double-stop after a
    // successful stop("Files generated.") + later failure.
    let spinnerActive = true;
    // Track files written by the generator outside the try so the catch can
    // roll them back if a later step (dep install) fails.
    let writtenForRollback = [];
    try {
        const result = await generateComponent(projectRoot, chosenORM, component, componentOptions);
        writtenForRollback = result.writtenFiles ?? [];
        installSpinner.stop(pc.green("Files generated."));
        spinnerActive = false;
        if (result.dependencies && result.dependencies.length > 0) {
            // Validate every dependency name before passing to execFile — prevents
            // a compromised registry from injecting arbitrary shell commands
            const safeDeps = result.dependencies.filter((d) => VALID_DEP_RE.test(d));
            if (safeDeps.length !== result.dependencies.length) {
                throw new Error("Registry returned one or more invalid dependency names. Aborting.");
            }
            const depSpinner = p.spinner();
            const installArgs = pm === "npm"
                ? ["install", ...safeDeps, "--silent"]
                : ["add", ...safeDeps, "--silent"];
            depSpinner.start(`Installing dependencies via ${pm}...`);
            try {
                // execFile — no shell spawned, so no shell injection possible
                await execFileAsync(pm, installArgs, { cwd: projectRoot });
                depSpinner.stop(pc.green("Dependencies installed."));
            }
            catch (err) {
                depSpinner.stop(pc.red("Dependency install failed."));
                throw err;
            }
        }
        // Surface generator warnings (adapter fallbacks, .gitignore misses, etc.)
        for (const w of result.warnings ?? []) {
            p.log.warn(w);
        }
        // Lock-file write is best-effort — a disk error here shouldn't blow up
        // the install or trigger file rollback.
        try {
            const lockPath = path.join(projectRoot, "infra.lock.json");
            let lock = { version: 1, components: {} };
            if (await fs.pathExists(lockPath)) {
                try {
                    lock = await fs.readJson(lockPath);
                    if (!lock.components)
                        lock.components = {};
                }
                catch {
                    /* corrupt lock — overwrite */
                }
            }
            lock.components[component] = {
                installedAt: new Date().toISOString(),
                files: (result.writtenFiles ?? []).map((f) => path.relative(projectRoot, f)),
                dependencies: result.dependencies,
            };
            await fs.outputJson(lockPath, lock, { spaces: 2 });
        }
        catch (err) {
            p.log.warn(`Failed to update infra.lock.json: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    catch (error) {
        // Only stop the install spinner if it's still running — otherwise we'd
        // overwrite a previous "Files generated." with "Failed." on the same spinner.
        if (spinnerActive) {
            installSpinner.stop(pc.red("Failed."));
            spinnerActive = false;
        }
        // Roll back files written by the generator. The generator self-cleans on
        // its own failures; this handles failures AFTER generation (dep install,
        // bad dep name, etc.) where files exist but the install is incomplete.
        if (writtenForRollback.length > 0) {
            await Promise.allSettled(writtenForRollback.map((f) => fs.remove(f)));
            p.log.info(`Rolled back ${writtenForRollback.length} file(s) written by the generator.`);
        }
        p.cancel(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
    p.outro(`🎉 ${pc.green(`${component} added successfully!`)}`);
});
program.parse(process.argv);
