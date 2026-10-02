import { constants } from "node:os";
import { spawnCloudflared } from "@cloudflare/workers-utils";
import { lt, valid } from "semver";
import { createChildProcessController } from "../lib/process.js";
import type { Logger } from "@cloudflare/workers-utils";
import type { ChildProcess } from "node:child_process";

export const CLOUDFLARED_LOG_LEVELS = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"panic",
	"disabled",
] as const;

const cloudflaredLogger = {
	debug: (...args: unknown[]): void => {
		const includesInvocation = args.some(
			(arg) =>
				typeof arg === "string" && arg.startsWith("Spawning cloudflared:")
		);
		if (process.env.DEBUG && !includesInvocation) {
			console.error(...args);
		}
	},
	log: (...args: unknown[]): void => {
		console.error(...args);
	},
	warn: (...args: unknown[]): void => {
		console.warn(...args);
	},
} satisfies Pick<Logger, "debug" | "log" | "warn">;

function readVersionProcess(child: ChildProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		child.stdout?.on("data", (chunk: Buffer | string) => {
			output += String(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			output += String(chunk);
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code !== 0) {
				reject(
					new Error(`Unable to determine cloudflared version (exit ${code}).`)
				);
				return;
			}
			const match = /cloudflared version\s+([^\s]+)/i.exec(output);
			if (match?.[1] === undefined) {
				reject(new Error("Unable to parse cloudflared version output."));
				return;
			}
			resolve(match[1]);
		});
	});
}

export function assertCloudflaredVersion(
	installedVersion: string,
	requiredVersion: string
): void {
	const installed = valid(installedVersion);
	const required = valid(requiredVersion);
	// Development manifests may use a git SHA. Release manifests use the
	// calendar-version tag and get the strict compatibility check.
	if (required === null) {
		return;
	}
	if (installed === null) {
		throw new Error(
			`cloudflared reported unsupported version ${JSON.stringify(installedVersion)}; cf requires ${requiredVersion} or newer for this command.`
		);
	}
	if (lt(installed, required)) {
		throw new Error(
			`cloudflared ${installedVersion} is older than ${requiredVersion}, which this cf command was generated for. Update the cloudflared selected by your PATH or CLOUDFLARED_PATH, or remove the override so cf can install a compatible version.`
		);
	}
}

async function ensureManifestCompatibility(args: string[]): Promise<void> {
	if (args[0] !== "access") {
		return;
	}
	const { cloudflaredManifest } = await import("./access/manifest.js");
	const child = await spawnCloudflared(["version"], {
		stdio: "pipe",
		logger: cloudflaredLogger,
	});
	const installedVersion = await readVersionProcess(child);
	assertCloudflaredVersion(
		installedVersion,
		cloudflaredManifest.cloudflaredVersion
	);
}

/**
 * Run cloudflared with inherited stdio and mirror its exit status.
 *
 * workers-utils owns binary discovery, download, caching, and validation.
 * cf disables cloudflared's self-updater so that lifecycle remains with the
 * binary manager that selected the executable.
 */
export async function runCloudflared(
	args: string[],
	options: {
		env?: Record<string, string>;
		forceKillAfterMs?: number | null;
	} = {}
): Promise<number> {
	await ensureManifestCompatibility(args);
	const { forceKillAfterMs = 5000, ...spawnOptions } = options;
	const child = await spawnCloudflared(["--no-autoupdate", ...args], {
		stdio: "inherit",
		logger: cloudflaredLogger,
		...spawnOptions,
	});
	const controller = createChildProcessController(child, {
		forwardSignals: true,
		forceKillAfterMs,
	});
	const { code, signal } = await controller.exited;
	if (code !== null) {
		return code;
	}
	return signal ? 128 + (constants.signals[signal] ?? 1) : 1;
}
