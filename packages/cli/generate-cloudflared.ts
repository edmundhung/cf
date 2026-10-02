import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accessMetadata } from "./src/commands/access/config.ts";
import { parseCloudflaredManifest } from "./src/commands/cloudflared-manifest.ts";

const bundledManifestPath = fileURLToPath(
	new URL(
		"./src/commands/access/cloudflared-cli-manifest.json",
		import.meta.url
	)
);
const sourcePath = process.env.CF_CLOUDFLARED_MANIFEST
	? resolve(process.env.CF_CLOUDFLARED_MANIFEST)
	: bundledManifestPath;

let source: unknown;
try {
	source = JSON.parse(readFileSync(sourcePath, "utf8"));
} catch (error) {
	const reason = error instanceof Error ? error.message : String(error);
	throw new Error(
		`Unable to read cloudflared manifest ${sourcePath}: ${reason}`
	);
}

const manifest = parseCloudflaredManifest(source);
const accessCommands = accessMetadata(manifest);
if (accessCommands.length === 0) {
	throw new Error("cloudflared manifest contains no Access commands.");
}

// cf only ships the portion it consumes. This keeps the lazy Access chunk
// small while the local override still validates the complete release asset.
const bundledManifest = {
	schemaVersion: manifest.schemaVersion,
	cloudflaredVersion: manifest.cloudflaredVersion,
	commands: manifest.commands.filter((command) => command.path[0] === "access"),
};
const metadataPath = fileURLToPath(
	new URL("./src/commands/access/meta.json", import.meta.url)
);
const tempDir = mkdtempSync(join(tmpdir(), "cf-cloudflared-manifest-"));
try {
	const tempManifestPath = join(tempDir, "cloudflared-cli-manifest.json");
	const tempMetadataPath = join(tempDir, "meta.json");
	writeFileSync(
		tempManifestPath,
		`${JSON.stringify(bundledManifest, null, 2)}\n`
	);
	writeFileSync(
		tempMetadataPath,
		`${JSON.stringify(accessCommands, null, "\t")}\n`
	);
	execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", [
		"exec",
		"oxfmt",
		tempManifestPath,
		tempMetadataPath,
	]);
	// Publish only fully formatted files so check:format can safely run in
	// parallel with generation under Turbo.
	writeFileSync(bundledManifestPath, readFileSync(tempManifestPath));
	writeFileSync(metadataPath, readFileSync(tempMetadataPath));
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}

console.log(
	`[cf-generator] Bundled cloudflared ${manifest.cloudflaredVersion} manifest with ${accessCommands.length} Access command(s)`
);
