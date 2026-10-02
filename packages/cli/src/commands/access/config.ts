import {
	cloudflaredOptionYargsType,
	firstDescriptionLine,
} from "../cloudflared-manifest.js";
import type {
	CloudflaredArgument,
	CloudflaredCommand,
	CloudflaredOption,
} from "../cloudflared-manifest.js";

export interface AccessOverlay {
	description?: string;
	requiredArguments?: readonly string[];
	requiredOptions?: readonly string[];
	optionDescriptions?: Readonly<Record<string, string>>;
	positionalDescriptions?: Readonly<Record<string, string>>;
	forwardNames?: Readonly<Record<string, string>>;
	sensitiveEnv?: Readonly<Record<string, string>>;
	optionOrder?: readonly string[];
}

export const ACCESS_OVERLAYS: Readonly<Record<string, AccessOverlay>> = {
	curl: {
		description:
			"Run curl against an Access-protected application with its JWT injected by cloudflared.",
		positionalDescriptions: {
			url: "URL of the Access application",
			"curl-args": "Arguments forwarded to curl after --",
		},
		optionDescriptions: {
			"allow-request": "Continue the request when no Access token is available",
		},
	},
	login: {
		description:
			"Authenticate with an Access application and store its JWT through cloudflared.",
		requiredArguments: ["url"],
		positionalDescriptions: { url: "URL of the Access application" },
	},
	"ssh-config": {
		description:
			"Print an example SSH configuration for an Access application.",
	},
	"ssh-gen": {
		description:
			"Generate a short-lived certificate for an Access SSH application.",
		requiredOptions: ["hostname"],
	},
	tcp: {
		description:
			"Proxy a TCP connection through Access. The command is also available as ssh, rdp, and smb.",
		requiredOptions: ["hostname"],
		forwardNames: { "log-level": "loglevel" },
		sensitiveEnv: {
			"service-token-secret": "TUNNEL_SERVICE_TOKEN_SECRET",
		},
		optionOrder: [
			"hostname",
			"destination",
			"url",
			"header",
			"service-token-id",
			"service-token-secret",
			"log-level",
		],
	},
	token: {
		description: "Print a JWT for authenticating with an Access application.",
		requiredArguments: ["url"],
		positionalDescriptions: { url: "URL of the Access application" },
	},
};

export function accessOverlay(command: CloudflaredCommand): AccessOverlay {
	return ACCESS_OVERLAYS[command.path.at(-1) ?? ""] ?? {};
}

export function isRequiredAccessArgument(
	argument: CloudflaredArgument,
	overlay: AccessOverlay
): boolean {
	return (
		argument.required ||
		overlay.requiredArguments?.includes(argument.name) === true
	);
}

export function isRequiredAccessOption(
	option: CloudflaredOption,
	overlay: AccessOverlay
): boolean {
	return (
		option.required || overlay.requiredOptions?.includes(option.name) === true
	);
}

function argumentToken(
	argument: CloudflaredArgument,
	overlay: AccessOverlay
): string {
	const name = `${argument.name}${argument.variadic ? ".." : ""}`;
	return isRequiredAccessArgument(argument, overlay)
		? `<${name}>`
		: `[${name}]`;
}

export function accessCommandString(command: CloudflaredCommand): string {
	const overlay = accessOverlay(command);
	return [
		command.path.at(-1),
		...command.arguments.map((argument) => argumentToken(argument, overlay)),
	]
		.filter((part): part is string => part !== undefined)
		.join(" ");
}

export function accessCommandDescription(command: CloudflaredCommand): string {
	return (
		accessOverlay(command).description ??
		firstDescriptionLine(command.description)
	);
}

export function sortedAccessOptions(
	command: CloudflaredCommand,
	overlay: AccessOverlay
): CloudflaredOption[] {
	const order = new Map(
		overlay.optionOrder?.map((name, index) => [name, index]) ?? []
	);
	return [...command.options].sort((left, right) => {
		const leftOrder = order.get(left.name) ?? Number.MAX_SAFE_INTEGER;
		const rightOrder = order.get(right.name) ?? Number.MAX_SAFE_INTEGER;
		return leftOrder - rightOrder;
	});
}

export function accessMetadata(manifest: {
	commands: CloudflaredCommand[];
}): unknown[] {
	return manifest.commands
		.filter(
			(command) =>
				command.path.length === 2 &&
				command.path[0] === "access" &&
				!command.hidden
		)
		.map((command) => {
			const name = command.path[1] as string;
			const overlay = accessOverlay(command);
			const options = sortedAccessOptions(command, overlay)
				.filter((option) => !option.hidden)
				.map((option) => ({
					name: option.name,
					...(option.aliases.length === 1
						? { alias: option.aliases[0] }
						: option.aliases.length > 1
							? { alias: option.aliases }
							: {}),
					type: cloudflaredOptionYargsType(option.type),
					required: isRequiredAccessOption(option, overlay),
					description:
						overlay.optionDescriptions?.[option.name] ?? option.usage ?? "",
				}));
			return {
				command: `cf access ${name}`,
				name,
				fullPath: ["access", name],
				...(command.aliases.length > 0 ? { aliases: command.aliases } : {}),
				category: "action",
				description: accessCommandDescription(command),
				usage: `cf access ${accessCommandString(command)}${options.length > 0 ? " [options]" : ""}`,
				arguments: command.arguments.map((argument, position) => ({
					name: argument.name,
					position,
					type: "string",
					required: isRequiredAccessArgument(argument, overlay),
					description: overlay.positionalDescriptions?.[argument.name] ?? "",
				})),
				options,
			};
		});
}
