import { CliExit } from "../../lib/cli-exit.js";
import { getComplianceRegion } from "../../lib/context.js";
import { withCloudflareDotEnv } from "../../lib/dotenv.js";
import { runWithTelemetry } from "../../lib/telemetry/run.js";
import {
	cloudflaredOptionYargsType,
	parseCloudflaredManifest,
} from "../cloudflared-manifest.js";
import { runCloudflared } from "../cloudflared.js";
import manifestJson from "./cloudflared-cli-manifest.json" with { type: "json" };
import {
	accessCommandDescription,
	accessCommandString,
	accessOverlay,
	isRequiredAccessArgument,
	isRequiredAccessOption,
	sortedAccessOptions,
} from "./config.js";
import type { CommonYargsOptions } from "../../lib/cli-types.js";
import type {
	CloudflaredCommand,
	CloudflaredManifest,
	CloudflaredOption,
} from "../cloudflared-manifest.js";
import type { ArgumentsCamelCase, Argv, CommandModule, Options } from "yargs";

type AccessArgs = CommonYargsOptions &
	Record<string, unknown> & {
		"--"?: (string | number)[];
	};

function cliValueString(value: unknown, name: string): string {
	if (
		typeof value !== "string" &&
		typeof value !== "number" &&
		typeof value !== "boolean"
	) {
		throw new Error(`Invalid value for ${name}.`);
	}
	return String(value);
}

export const cloudflaredManifest = parseCloudflaredManifest(manifestJson);

function buildLeaf(
	yargs: Argv<CommonYargsOptions>,
	command: CloudflaredCommand
): Argv<AccessArgs> {
	const overlay = accessOverlay(command);
	let result = yargs.parserConfiguration({
		"boolean-negation": false,
		"parse-positional-numbers": false,
		"populate--": command.skipFlagParsing,
		"short-option-groups": command.shortOptionGroups,
	});
	for (const option of sortedAccessOptions(command, overlay)) {
		const config: Options = {
			type: cloudflaredOptionYargsType(option.type),
			alias: option.aliases,
			array: option.repeatable,
			demandOption: isRequiredAccessOption(option, overlay),
			hidden: option.hidden,
			description:
				overlay.optionDescriptions?.[option.name] ?? option.usage ?? "",
		};
		result = result.option(option.name, config);
	}
	for (const argument of command.arguments) {
		result = result.positional(argument.name, {
			type: "string",
			array: argument.variadic,
			demandOption: isRequiredAccessArgument(argument, overlay),
			description: overlay.positionalDescriptions?.[argument.name] ?? "",
		});
	}
	return result as Argv<AccessArgs>;
}

function appendOption(
	args: string[],
	name: string,
	value: unknown,
	option: CloudflaredOption
): void {
	if (value === undefined || value === false) {
		return;
	}
	const values = Array.isArray(value) ? value : [value];
	for (const entry of values) {
		args.push(`--${name}`);
		if (option.type !== "boolean") {
			args.push(cliValueString(entry, `--${name}`));
		}
	}
}

async function runAccessCommand(
	command: CloudflaredCommand,
	argv: ArgumentsCamelCase<AccessArgs>
): Promise<void> {
	const name = command.path.at(-1);
	if (name === undefined) {
		throw new Error("Invalid Access command path.");
	}
	if (argv.local) {
		throw new Error(`--local is not supported by cf access ${name}.`);
	}

	const complianceRegion = await withCloudflareDotEnv(
		{ mode: argv.mode, local: argv.local },
		() => getComplianceRegion()
	);
	if (name === "ssh-config" && complianceRegion === "fedramp_high") {
		throw new Error(
			"cf access ssh-config does not support FedRAMP because cloudflared does not include --fedramp in its generated SSH configuration."
		);
	}

	const args = ["access"];
	if (complianceRegion === "fedramp_high") {
		args.push("--fedramp");
	}
	args.push(name);
	const overlay = accessOverlay(command);
	const env: Record<string, string> = {};
	for (const option of sortedAccessOptions(command, overlay)) {
		const value = argv[option.name];
		const envName = overlay.sensitiveEnv?.[option.name];
		if (envName !== undefined && value !== undefined) {
			env[envName] = cliValueString(value, `--${option.name}`);
			continue;
		}
		appendOption(
			args,
			overlay.forwardNames?.[option.name] ?? option.name,
			value,
			option
		);
	}
	for (const argument of command.arguments) {
		const value = argv[argument.name];
		if (Array.isArray(value)) {
			args.push(...value.map((entry) => cliValueString(entry, argument.name)));
		} else if (value !== undefined) {
			args.push(cliValueString(value, argument.name));
		}
	}
	args.push(...(argv["--"] ?? []).map(String));

	const exitCode =
		name === "tcp"
			? await runCloudflared(args, {
					env: Object.keys(env).length === 0 ? undefined : env,
				})
			: await runCloudflared(args);
	throw new CliExit(exitCode);
}

function accessLeaf(
	command: CloudflaredCommand
): CommandModule<CommonYargsOptions> {
	const name = command.path.at(-1);
	if (name === undefined) {
		throw new Error("Invalid Access command path.");
	}
	return {
		command: accessCommandString(command),
		aliases: command.aliases,
		describe: accessCommandDescription(command),
		builder: (yargs) => buildLeaf(yargs, command),
		handler: (argv) =>
			runWithTelemetry(
				{ command: `access ${name}`, recordArgs: false },
				argv,
				() => runAccessCommand(command, argv as ArgumentsCamelCase<AccessArgs>)
			),
	};
}

export function accessCommandsFromManifest(
	manifest: CloudflaredManifest
): CommandModule<CommonYargsOptions>[] {
	return manifest.commands
		.filter(
			(command) =>
				command.path.length === 2 &&
				command.path[0] === "access" &&
				!command.hidden
		)
		.map(accessLeaf);
}

export const accessCommands = accessCommandsFromManifest(cloudflaredManifest);
