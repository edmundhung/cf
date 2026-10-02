import { accessCommands } from "./manifest.js";
import type { CommonYargsOptions } from "../../lib/cli-types.js";
import type { Argv, CommandModule } from "yargs";

const command: CommandModule<CommonYargsOptions> = {
	command: "access",
	describe: "Access protected applications and services",
	builder: (yargs: Argv<CommonYargsOptions>) =>
		yargs.command(accessCommands).demandCommand(),
	handler: () => {},
};

export default command;
