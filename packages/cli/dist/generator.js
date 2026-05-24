import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
const providerCasing = {
    google: "Google",
    github: "GitHub",
    facebook: "Facebook",
    discord: "Discord",
};
const DEFAULT_REGISTRY_BASE = "https://raw.githubusercontent.com/DrPrime01/test-infra-monorepo/refs/heads/main/packages/registry";
// Override at runtime to pin to a specific commit/tag, e.g.:
//   INFRA_REGISTRY_BASE=https://raw.githubusercontent.com/DrPrime01/test-infra-monorepo/refs/tags/v0.2.0/packages/registry
const REGISTRY_BASE = process.env.INFRA_REGISTRY_BASE ?? DEFAULT_REGISTRY_BASE;
const MAX_PAYLOAD_BYTES = 1_000_000;
// Path-traversal + symlink-escape guard.
// 1) `path.resolve` normalizes `..` traversal.
// 2) We walk up to the deepest existing ancestor and `realpath` it — that
//    catches a malicious symlink anywhere up the chain (e.g. `infra` →
//    `/etc`) before we ever write through it.
async function assertSafePath(targetPath, realRoot) {
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget !== realRoot &&
        !resolvedTarget.startsWith(realRoot + path.sep)) {
        throw new Error(`Refusing to write outside project root: ${resolvedTarget}`);
    }
    let cursor = path.dirname(resolvedTarget);
    while (cursor !== path.dirname(cursor)) {
        try {
            const realCursor = await fs.realpath(cursor);
            if (realCursor !== realRoot &&
                !realCursor.startsWith(realRoot + path.sep)) {
                throw new Error(`Path escapes project root via symlink: ${cursor} → ${realCursor}`);
            }
            return;
        }
        catch (err) {
            const code = err.code;
            if (code === "ENOENT") {
                cursor = path.dirname(cursor);
                continue;
            }
            throw err;
        }
    }
}
async function fetchRegistry(component) {
    const url = `${REGISTRY_BASE}/${component}.json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
        throw new Error(`Failed to fetch component registry (${url}). Status: ${response.status}`);
    }
    if (!response.body) {
        throw new Error("Registry response had no body.");
    }
    // Stream the body so a Content-Length lie can't OOM us — abort mid-stream
    // when the cap is exceeded rather than buffering the full payload first.
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    let streamCompleted = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            received += value.length;
            if (received > MAX_PAYLOAD_BYTES) {
                throw new Error(`Registry payload exceeded ${MAX_PAYLOAD_BYTES} bytes; aborting.`);
            }
            chunks.push(value);
        }
        streamCompleted = true;
    }
    finally {
        // Always release the stream — covers both normal completion and any
        // mid-stream rejection. cancel() on a finished stream is a no-op.
        if (!streamCompleted) {
            await reader.cancel().catch(() => { });
        }
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    const payload = JSON.parse(text);
    // Optional per-file integrity. If the registry ships `integrity: { "client.ts": "sha256-..." }`,
    // we verify every file. Missing field = no verification (backwards compatible).
    if (payload.integrity && typeof payload.integrity === "object") {
        const integrity = payload.integrity;
        const files = (payload.files ?? {});
        for (const [name, expected] of Object.entries(integrity)) {
            const content = files[name];
            if (typeof content !== "string") {
                throw new Error(`Integrity declared for "${name}" but file missing.`);
            }
            const actual = "sha256-" +
                crypto.createHash("sha256").update(content).digest("base64");
            if (actual !== expected) {
                throw new Error(`Integrity check failed for "${name}". Expected ${expected}, got ${actual}.`);
            }
        }
    }
    return payload;
}
// Ask git itself whether a file is gitignored. Returns:
//   true  → ignored
//   false → tracked / not ignored
//   null  → couldn't determine (not a repo, git not installed, etc.)
async function isGitIgnored(relPath, cwd) {
    try {
        await execFileAsync("git", ["check-ignore", "-q", relPath], { cwd });
        return true;
    }
    catch (err) {
        // `git check-ignore -q` exits 1 for "not ignored" — surfaced as numeric
        // code on the rejected ExecFileException. Anything else (ENOENT, 128,
        // string codes) means we couldn't determine.
        const code = err.code;
        if (code === 1 || code === "1")
            return false;
        return null;
    }
}
// One-shot write with optional mode. fs.writeFile's `mode` option is only
// honored when CREATING the file (Node POSIX semantics); for existing files
// we explicitly chmod after writing so secrets always end up at the requested
// permission regardless of pre-existing perms.
async function writeFileAtomic(target, content, mode) {
    await fs.ensureDir(path.dirname(target));
    if (mode !== undefined) {
        await fs.writeFile(target, content, { mode });
        // Explicit chmod — covers the existing-file case where the constructor
        // `mode` was silently ignored. Best-effort on non-POSIX FS.
        try {
            await fs.chmod(target, mode);
        }
        catch {
            /* Windows / non-POSIX — accept */
        }
    }
    else {
        await fs.writeFile(target, content);
    }
}
export async function generateComponent(projectRoot, orm, component, options) {
    const payload = (await fetchRegistry(component));
    // Realpath the project root once — anchor for all symlink-aware checks.
    const realRoot = await fs.realpath(projectRoot);
    const hasSrcDirectory = await fs.pathExists(path.join(realRoot, "src"));
    const baseDir = hasSrcDirectory ? "src" : "";
    const rootTargetDir = path.join(realRoot, baseDir);
    const infraComponentName = component === "authjs" ? "auth" : component;
    const infraDir = path.join(realRoot, baseDir, "infra", infraComponentName);
    const isAppRouter = options?.isAppRouter ?? true;
    const warnings = [];
    // Plan every write first; nothing hits disk until all paths are validated.
    const plannedWrites = [];
    const plan = async (target, content) => {
        await assertSafePath(target, realRoot);
        plannedWrites.push({ target, content });
    };
    const files = (payload.files ?? {});
    for (const [fileName, rawContent] of Object.entries(files)) {
        let fileContent = rawContent;
        if (fileName.includes("/")) {
            if (fileName.startsWith("app/") && !isAppRouter)
                continue;
            if (fileName.startsWith("pages/") && isAppRouter)
                continue;
            await plan(path.join(rootTargetDir, fileName), fileContent);
            continue;
        }
        if (fileName === "auth.ts" && component === "authjs") {
            let imports = "";
            let array = "";
            const providers = options?.providers ?? [];
            providers.forEach((p) => {
                const properName = providerCasing[p] ?? p;
                imports += `import ${properName} from "next-auth/providers/${p}";\n`;
                array += `    ${properName},\n`;
            });
            fileContent = fileContent
                .replace("{{PROVIDER_IMPORTS}}", imports.trim())
                .replace("{{PROVIDER_ARRAY}}", array.trimEnd());
            await plan(path.join(rootTargetDir, fileName), fileContent);
        }
        else if (fileName === "route.ts" && component === "authjs") {
            const apiDir = path.join(rootTargetDir, "app", "api", "auth", "[...nextauth]");
            await plan(path.join(apiDir, fileName), fileContent);
        }
        else if (fileName === "route.ts") {
            const apiDir = path.join(rootTargetDir, "app", "api", "webhooks", component);
            await plan(path.join(apiDir, fileName), fileContent);
        }
        else {
            await plan(path.join(infraDir, fileName), fileContent);
        }
    }
    const adapters = payload.adapters;
    if (adapters) {
        const adapterContent = adapters[orm] ?? adapters["manual"];
        if (adapterContent === undefined) {
            // Defensive: a malformed registry could omit both the user's ORM and
            // the "manual" fallback. Skip the write and tell the user.
            warnings.push(`${component}: no adapter for ORM "${orm}" and no "manual" fallback in registry. Skipping adapter.ts — you'll need to write your own.`);
        }
        else {
            if (!adapters[orm] && adapters["manual"]) {
                warnings.push(`No ${orm} adapter for ${component}; using "manual" placeholder. Implement the adapter before going to production.`);
            }
            await plan(path.join(infraDir, "adapter.ts"), adapterContent);
        }
    }
    // --- Middleware handling (sidecar for Clerk conflicts; merge for Auth.js) ---
    const middlewareTemplates = payload.middlewareTemplates;
    let middlewareWrite = null;
    if (middlewareTemplates) {
        let nextVersion = 16;
        try {
            const userPkg = await fs.readJson(path.join(realRoot, "package.json"));
            const rawVersion = userPkg.dependencies?.next ?? userPkg.devDependencies?.next ?? "16.0.0";
            const cleanVersion = String(rawVersion).replace(/[^0-9.]/g, "");
            nextVersion = parseInt(cleanVersion.split(".")[0], 10);
            if (Number.isNaN(nextVersion))
                nextVersion = 16;
        }
        catch {
            /* default to 16 safely */
        }
        const isNext16 = nextVersion >= 16;
        const interceptorFileName = isNext16 ? "proxy.ts" : "middleware.ts";
        const interceptorPath = path.join(rootTargetDir, interceptorFileName);
        const templateKey = isNext16 ? "proxy" : "legacy";
        const baseTemplate = middlewareTemplates[templateKey];
        if (typeof baseTemplate !== "string" || baseTemplate.length === 0) {
            // Registry shipped middlewareTemplates but not for this router type —
            // bail rather than write `undefined` to disk.
            warnings.push(`${component}: no middleware template for "${templateKey}" (Next ${nextVersion}). Skipping middleware write.`);
        }
        else {
            await assertSafePath(interceptorPath, realRoot);
            if (await fs.pathExists(interceptorPath)) {
                const existingContent = await fs.readFile(interceptorPath, "utf-8");
                const authImportRe = /from\s+['"]\.\/auth['"]/;
                // Match the actual call site — `clerkMiddleware(...)` — not a bare
                // string that could appear in a comment or unrelated identifier.
                const clerkCallRe = /clerkMiddleware\s*\(/;
                if (component === "authjs" && !authImportRe.test(existingContent)) {
                    middlewareWrite = {
                        target: interceptorPath,
                        content: `import { auth } from "./auth";\n${existingContent}`,
                    };
                }
                else if (component === "clerk" &&
                    !clerkCallRe.test(existingContent)) {
                    const sidecarPath = path.join(rootTargetDir, `${path.basename(interceptorFileName, ".ts")}.clerk.example.ts`);
                    await assertSafePath(sidecarPath, realRoot);
                    middlewareWrite = { target: sidecarPath, content: baseTemplate };
                    warnings.push(`Existing ${interceptorFileName} detected — Clerk template written to ${path.basename(sidecarPath)} instead. Merge manually.`);
                }
            }
            else {
                middlewareWrite = { target: interceptorPath, content: baseTemplate };
            }
        }
    }
    if (middlewareWrite) {
        plannedWrites.push(middlewareWrite);
    }
    // --- Atomic-ish write with rollback ---
    // Push BEFORE awaiting so rollback covers every planned path, even if a
    // sibling task succeeds after another rejects. Use `allSettled` so all
    // writes finish before rollback starts — otherwise a late-completing write
    // could recreate a file after `fs.remove` already ran.
    const writtenFiles = [];
    const results = await Promise.allSettled(plannedWrites.map(async (w) => {
        writtenFiles.push(w.target);
        await writeFileAtomic(w.target, w.content);
    }));
    const firstFailure = results.find((r) => r.status === "rejected");
    if (firstFailure) {
        await Promise.allSettled(writtenFiles.map((f) => fs.remove(f)));
        throw firstFailure.reason;
    }
    // --- Env vars ---
    if (options?.env && Object.keys(options.env).length > 0) {
        const envLocalPath = path.join(realRoot, ".env.local");
        await assertSafePath(envLocalPath, realRoot);
        let envContent = "";
        if (await fs.pathExists(envLocalPath)) {
            envContent = await fs.readFile(envLocalPath, "utf-8");
            if (!envContent.endsWith("\n"))
                envContent += "\n";
        }
        else {
            envContent = "# Make sure this file is listed in your .gitignore!\n";
        }
        const sectionHeader = payload.envSectionHeader ??
            `# ${component} Configuration`;
        envContent += `\n${sectionHeader}\n`;
        for (const [key, value] of Object.entries(options.env)) {
            const safeValue = (value ?? "")
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"');
            envContent += `${key}="${safeValue}"\n`;
        }
        // Write with 0o600 in one shot — no default-perm race window on secrets.
        await writeFileAtomic(envLocalPath, envContent, 0o600);
        writtenFiles.push(envLocalPath);
        // Ask git whether .env.local is ignored. Avoids gitignore-syntax guessing.
        const ignored = await isGitIgnored(".env.local", realRoot);
        if (ignored === false) {
            warnings.push(".env.local is NOT ignored by git — secrets could be committed.");
        }
        else if (ignored === null) {
            warnings.push("Couldn't verify .env.local is gitignored (not a git repo or git unavailable). Make sure it is before committing.");
        }
    }
    // --- Conditional dependencies (registry-declared) ---
    // Schema: [{ when: { ormIn?: string[], isAppRouter?: boolean }, deps: string[] }]
    // {{orm}} in dep strings is replaced with the resolved ORM name.
    const baseDeps = (payload.dependencies ?? []).slice();
    const rawConditional = payload.conditionalDeps;
    const conditional = [];
    if (Array.isArray(rawConditional)) {
        for (const rule of rawConditional) {
            // Validate the FULL shape: rule.when's predicates must be the right
            // types, otherwise a typo like `ormIn: [1, 2]` or `isAppRouter: "true"`
            // would pass a loose check and then silently never match anything.
            const shapeOk = rule &&
                typeof rule === "object" &&
                rule.when &&
                typeof rule.when === "object" &&
                Array.isArray(rule.deps) &&
                rule.deps.every((d) => typeof d === "string");
            const ormInOk = rule?.when?.ormIn === undefined ||
                (Array.isArray(rule.when.ormIn) &&
                    rule.when.ormIn.every((s) => typeof s === "string"));
            const routerOk = rule?.when?.isAppRouter === undefined ||
                typeof rule.when.isAppRouter === "boolean";
            if (shapeOk && ormInOk && routerOk) {
                conditional.push(rule);
            }
            else {
                warnings.push("Skipping a malformed conditionalDeps rule.");
            }
        }
    }
    else if (rawConditional !== undefined) {
        warnings.push("conditionalDeps was not an array; ignoring.");
    }
    for (const rule of conditional) {
        const ormMatch = !rule.when.ormIn || rule.when.ormIn.includes(orm);
        const routerMatch = rule.when.isAppRouter === undefined ||
            rule.when.isAppRouter === isAppRouter;
        if (!ormMatch || !routerMatch)
            continue;
        for (const dep of rule.deps) {
            if (dep.includes("{{orm}}")) {
                // `manual` isn't a DetectedORM literal but is a valid infra.json value
                // (user picks it during init when no ORM is detected). Compare as string.
                const ormStr = orm;
                if (ormStr === "UNKNOWN" || ormStr === "manual") {
                    warnings.push(`Skipping conditional dep "${dep}" — no concrete ORM detected (got "${ormStr}").`);
                    continue;
                }
                baseDeps.push(dep.replace(/\{\{orm\}\}/g, ormStr));
            }
            else {
                baseDeps.push(dep);
            }
        }
    }
    return {
        dependencies: baseDeps,
        warnings,
        writtenFiles,
    };
}
