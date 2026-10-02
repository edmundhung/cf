export const CLOUDFLARED_MANIFEST_SCHEMA_VERSION = 1;

const OPTION_TYPES = [
	"boolean",
	"duration",
	"integer",
	"number",
	"path",
	"string",
	"timestamp",
] as const;

export type CloudflaredOptionType = (typeof OPTION_TYPES)[number];

export interface CloudflaredArgument {
	name: string;
	required: boolean;
	variadic: boolean;
}

export interface CloudflaredOption {
	name: string;
	aliases: string[];
	type: CloudflaredOptionType;
	repeatable: boolean;
	required: boolean;
	hidden: boolean;
	usage?: string;
	envVars: string[];
}

export interface CloudflaredCommand {
	path: string[];
	aliases: string[];
	usage?: string;
	usageText?: string;
	description?: string;
	argsUsage?: string;
	arguments: CloudflaredArgument[];
	hidden: boolean;
	skipFlagParsing: boolean;
	shortOptionGroups: boolean;
	options: CloudflaredOption[];
}

export interface CloudflaredManifest {
	schemaVersion: 1;
	cloudflaredVersion: string;
	globalOptions: CloudflaredOption[];
	commands: CloudflaredCommand[];
}

type JsonObject = Record<string, unknown>;

function objectAt(value: unknown, path: string): JsonObject {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path} must be an object.`);
	}
	return value as JsonObject;
}

function stringAt(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${path} must be a non-empty string.`);
	}
	return value;
}

function optionalStringAt(value: unknown, path: string): string | undefined {
	return value === undefined ? undefined : stringAt(value, path);
}

function booleanAt(value: unknown, path: string): boolean {
	if (value === undefined) {
		return false;
	}
	if (typeof value !== "boolean") {
		throw new Error(`${path} must be a boolean.`);
	}
	return value;
}

function stringArrayAt(value: unknown, path: string): string[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error(`${path} must be an array.`);
	}
	return value.map((entry, index) => stringAt(entry, `${path}[${index}]`));
}

function optionAt(value: unknown, path: string): CloudflaredOption {
	const option = objectAt(value, path);
	const type = stringAt(option.type, `${path}.type`);
	if (!(OPTION_TYPES as readonly string[]).includes(type)) {
		throw new Error(
			`${path}.type has unsupported value ${JSON.stringify(type)}.`
		);
	}
	return {
		name: stringAt(option.name, `${path}.name`),
		aliases: stringArrayAt(option.aliases, `${path}.aliases`),
		type: type as CloudflaredOptionType,
		repeatable: booleanAt(option.repeatable, `${path}.repeatable`),
		required: booleanAt(option.required, `${path}.required`),
		hidden: booleanAt(option.hidden, `${path}.hidden`),
		usage: optionalStringAt(option.usage, `${path}.usage`),
		envVars: stringArrayAt(option.envVars, `${path}.envVars`),
	};
}

function argumentAt(value: unknown, path: string): CloudflaredArgument {
	const argument = objectAt(value, path);
	return {
		name: stringAt(argument.name, `${path}.name`),
		required: booleanAt(argument.required, `${path}.required`),
		variadic: booleanAt(argument.variadic, `${path}.variadic`),
	};
}

function arrayAt<T>(
	value: unknown,
	path: string,
	parse: (entry: unknown, path: string) => T
): T[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error(`${path} must be an array.`);
	}
	return value.map((entry, index) => parse(entry, `${path}[${index}]`));
}

function commandAt(value: unknown, path: string): CloudflaredCommand {
	const command = objectAt(value, path);
	return {
		path: stringArrayAt(command.path, `${path}.path`),
		aliases: stringArrayAt(command.aliases, `${path}.aliases`),
		usage: optionalStringAt(command.usage, `${path}.usage`),
		usageText: optionalStringAt(command.usageText, `${path}.usageText`),
		description: optionalStringAt(command.description, `${path}.description`),
		argsUsage: optionalStringAt(command.argsUsage, `${path}.argsUsage`),
		arguments: arrayAt(command.arguments, `${path}.arguments`, argumentAt),
		hidden: booleanAt(command.hidden, `${path}.hidden`),
		skipFlagParsing: booleanAt(
			command.skipFlagParsing,
			`${path}.skipFlagParsing`
		),
		shortOptionGroups: booleanAt(
			command.shortOptionGroups,
			`${path}.shortOptionGroups`
		),
		options: arrayAt(command.options, `${path}.options`, optionAt),
	};
}

function assertUnique(values: string[], label: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			throw new Error(`${label} contains duplicate ${JSON.stringify(value)}.`);
		}
		seen.add(value);
	}
}

/** Parse the release artifact strictly so schema drift fails generation. */
export function parseCloudflaredManifest(value: unknown): CloudflaredManifest {
	const manifest = objectAt(value, "cloudflared manifest");
	if (manifest.schemaVersion !== CLOUDFLARED_MANIFEST_SCHEMA_VERSION) {
		throw new Error(
			`Unsupported cloudflared manifest schemaVersion ${JSON.stringify(manifest.schemaVersion)}; expected ${CLOUDFLARED_MANIFEST_SCHEMA_VERSION}.`
		);
	}
	const parsed: CloudflaredManifest = {
		schemaVersion: CLOUDFLARED_MANIFEST_SCHEMA_VERSION,
		cloudflaredVersion: stringAt(
			manifest.cloudflaredVersion,
			"cloudflared manifest.cloudflaredVersion"
		),
		globalOptions: arrayAt(
			manifest.globalOptions,
			"cloudflared manifest.globalOptions",
			optionAt
		),
		commands: arrayAt(
			manifest.commands,
			"cloudflared manifest.commands",
			commandAt
		),
	};
	assertUnique(
		parsed.commands.map((command) => command.path.join("\0")),
		"cloudflared manifest command paths"
	);
	for (const command of parsed.commands) {
		if (command.path.length === 0) {
			throw new Error("cloudflared manifest command paths must not be empty.");
		}
		assertUnique(
			command.options.map((option) => option.name),
			`cloudflared command ${command.path.join(" ")} options`
		);
		assertUnique(
			command.arguments.map((argument) => argument.name),
			`cloudflared command ${command.path.join(" ")} arguments`
		);
	}
	return parsed;
}

export function cloudflaredCommand(
	manifest: CloudflaredManifest,
	path: readonly string[]
): CloudflaredCommand {
	const command = manifest.commands.find(
		(candidate) =>
			candidate.path.length === path.length &&
			candidate.path.every((segment, index) => segment === path[index])
	);
	if (command === undefined) {
		throw new Error(`cloudflared manifest has no command ${path.join(" ")}.`);
	}
	return command;
}

export function cloudflaredOptionYargsType(
	type: CloudflaredOptionType
): "boolean" | "number" | "string" {
	if (type === "boolean") {
		return "boolean";
	}
	if (type === "integer" || type === "number") {
		return "number";
	}
	return "string";
}

export function firstDescriptionLine(description?: string): string {
	return description?.replaceAll(/\s+/g, " ").trim() ?? "";
}
