import { describe, expect, it } from "vitest";
import manifestJson from "../../../commands/access/cloudflared-cli-manifest.json" with { type: "json" };
import { accessMetadata } from "../../../commands/access/config.js";
import metadataJson from "../../../commands/access/meta.json" with { type: "json" };
import {
	CLOUDFLARED_MANIFEST_SCHEMA_VERSION,
	cloudflaredCommand,
	parseCloudflaredManifest,
} from "../../../commands/cloudflared-manifest.js";

describe("cloudflared Access manifest", () => {
	it("parses the bundled release contract without dropping commands", () => {
		const manifest = parseCloudflaredManifest(manifestJson);
		const accessCommands = manifest.commands.filter(
			(command) => command.path[0] === "access" && command.path.length === 2
		);

		expect(manifest.schemaVersion).toBe(CLOUDFLARED_MANIFEST_SCHEMA_VERSION);
		expect(accessCommands.map((command) => command.path[1])).toEqual([
			"curl",
			"login",
			"ssh-config",
			"ssh-gen",
			"tcp",
			"token",
		]);
		expect(
			cloudflaredCommand(manifest, ["access", "curl"]).options.map(
				(option) => option.name
			)
		).toContain("allow-request");
	});

	it("keeps instant search and completion metadata in sync", () => {
		const manifest = parseCloudflaredManifest(manifestJson);
		expect(accessMetadata(manifest)).toEqual(metadataJson);
	});

	it("fails closed on an unsupported schema", () => {
		expect(() =>
			parseCloudflaredManifest({
				...manifestJson,
				schemaVersion: 2,
			})
		).toThrow("Unsupported cloudflared manifest schemaVersion 2");
	});
});
