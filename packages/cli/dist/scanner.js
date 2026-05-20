import fs from "fs-extra";
import path from "path";
export async function detectEnvironment(projectRoot) {
    const pkgPath = path.join(projectRoot, "package.json");
    // Check if we are actually in a Node/NPM project
    if (!(await fs.pathExists(pkgPath))) {
        throw new Error("Could not find package.json. Are you in the root of your project?");
    }
    // Read the package.json to scan dependencies
    const pkg = await fs.readJson(pkgPath);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    let packageManager = "npm"; // Default fallback
    if (await fs.pathExists(path.join(projectRoot, "pnpm-lock.yaml"))) {
        packageManager = "pnpm";
    }
    else if (await fs.pathExists(path.join(projectRoot, "bun.lockb"))) {
        packageManager = "bun";
    }
    else if (await fs.pathExists(path.join(projectRoot, "yarn.lock"))) {
        packageManager = "yarn";
    }
    else if (await fs.pathExists(path.join(projectRoot, "package-lock.json"))) {
        packageManager = "npm";
    }
    // Default to UNKNOWN
    let orm = "UNKNOWN";
    // Heuristic Scan: Look for specific package signatures
    if (deps["prisma"] || deps["@prisma/client"]) {
        orm = "prisma";
    }
    else if (deps["drizzle-orm"]) {
        orm = "drizzle-orm";
    }
    else if (deps["sequelize"]) {
        orm = "sequelize";
    }
    else if (deps["typeorm"]) {
        orm = "typeorm";
    }
    else if (deps["@mikro-orm/core"]) {
        orm = "mikro-orm";
    }
    else if (deps["objection"]) {
        orm = "objection";
    }
    else if (deps["knex"]) {
        orm = "knex";
    }
    // Detect Next.js specific pathing (App router vs Pages router)
    const isAppRouter = await fs.pathExists(path.join(projectRoot, "app"));
    const srcPath = await fs.pathExists(path.join(projectRoot, "src"));
    return {
        orm,
        packageManager,
        isAppRouter,
        basePath: srcPath ? "src" : "",
        tailwind: !!deps["tailwindcss"],
    };
}
