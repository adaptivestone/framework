import path from "node:path";
import * as url from "node:url";
import type { ParseArgsOptionDescriptor } from "node:util";
import { parseArgs } from "node:util";
import type AbstractCommand from "../modules/AbstractCommand.ts";
import type Server from "../server.ts";
import Base from "./Base.ts";

export interface ParseArgsOptionsConfigExtended
  extends ParseArgsOptionDescriptor {
  /**
   * A description of the option.
   */
  description?: string;

  /**
   * Is it required?
   */
  required?: boolean;
}

class Cli extends Base {
  server: Server;
  commands: Record<string, string>;

  constructor(server: Server) {
    super(server.app);
    this.server = server;
    this.commands = {};
  }

  async loadCommands(): Promise<boolean> {
    if (Object.keys(this.commands).length) {
      return true;
    }
    console.info("Loading commands...");
    console.time("Loading commands. Time");
    const dirname = url.fileURLToPath(new URL(".", import.meta.url));
    const commandsToLoad = await this.getFilesPathWithInheritance(
      path.join(dirname, "../commands"),
      this.server.app.foldersConfig.commands,
      true,
    );
    for (const com of commandsToLoad) {
      if (com.file.endsWith(".js") || com.file.endsWith(".ts")) {
        const c = com.file.replace(".js", "").replace(".ts", "");
        if (this.commands[c.toLowerCase()]) {
          this.logger?.warn(
            `Command ${c.toLowerCase()} already exists with full path ${this.commands[c.toLowerCase()]}. Possible problems - you have two commands with "ts" and "js" extensions. Skipping...`,
          );
          continue;
        }
        this.commands[c.toLowerCase()] = com.path;
      }
    }
    console.timeEnd("Loading commands. Time");
    console.log(" ");

    return true;
  }

  async printCommandTable() {
    const commands = Object.keys(this.commands).sort();
    const maxLength = commands.reduce((max, c) => Math.max(max, c.length), 0);
    console.log("Available commands:");
    const commandsClasses = [];
    for (const c of commands) {
      commandsClasses.push(import(this.commands[c]));
      // console.log(
      //   ` \x1b[36m${c.padEnd(maxLength)}\x1b[0m - ${f.default.description}`,
      // );
    }
    const commandsClassesLoaded: Array<
      Record<"default", typeof AbstractCommand>
    > = await Promise.all(commandsClasses);
    for (const [key, c] of Object.entries(commands)) {
      console.log(
        ` \x1b[36m${c.padEnd(maxLength)}\x1b[0m - ${commandsClassesLoaded[+key].default.description}`,
      );
    }
    console.log(
      "\nUsage (use one of option): \n node cli.ts <command> [options] \n npm run cli <command>  -- [options]",
    );
  }

  static showHelp(
    Command: typeof AbstractCommand,
    finalArguments: Record<string, ParseArgsOptionsConfigExtended>,
  ) {
    console.log(`\n\x1b[32m${Command.description}\x1b[0m`);
    let output = "";

    Object.entries(finalArguments).forEach(([key, opt]) => {
      const outputLocal = [];
      outputLocal.push(`\n\x1b[36m  --${key} \x1b[0m`);
      if (opt.type !== "boolean") {
        outputLocal.push(`<${opt.type}>`);
        // flag += `<${opt.type}>`;
      }
      if (opt.required) {
        outputLocal.push("(required)");
      }
      outputLocal.push(`\n      \x1b[2m${opt.description}`);
      if (opt.default !== undefined) {
        outputLocal.push(` (default: ${opt.default})`);
      }
      outputLocal.push("\x1b[0m");
      output += outputLocal.join(" ");
    });

    console.log(output);
  }

  async run(command: string) {
    await this.loadCommands();

    if (!command) {
      console.log("Please provide command name");
      await this.printCommandTable();
      return false;
    }

    if (!this.commands[command]) {
      console.log(`Command ${command} not found `);
      await this.printCommandTable();
      return false;
    }
    console.info(`Running command: '${command}'`);
    const commandModule: { default: typeof AbstractCommand } = await import(
      this.commands[command]
    );
    const Command: typeof AbstractCommand = commandModule.default;

    const defaultArgs: Record<string, ParseArgsOptionsConfigExtended> = {
      help: {
        type: "boolean",
        description: "Show help",
      },
    };

    const finalArguments = {
      ...Command.commandArguments,
      ...defaultArgs,
    };

    const parsedArgs = parseArgs({
      args: process.argv.slice(3), // remove command name
      options: finalArguments,
      tokens: true,
    });

    if (parsedArgs.values.help) {
      Cli.showHelp(Command, finalArguments);
      return true;
    }

    for (const [key, opt] of Object.entries(finalArguments)) {
      if (opt.required && !parsedArgs.values[key]) {
        console.log(
          `\x1b[31mRequired field not proivded. Please provide "${key}" argument\x1b[0m`,
        );
        Cli.showHelp(Command, finalArguments);
        return false;
      }
    }

    if (Command.isShouldGetModelPaths) {
      console.info(
        `Command ${command} isShouldGetModelPaths called. We are loading model paths`,
      );
      await this.server.getModelFilesPathsWithInheritance();
    }

    if (Command.isShouldInitModels) {
      console.info(
        `Command ${command} isShouldInitModels called. If you want to skip loading and init models, please set isShouldInitModels to false in tyou command`,
      );
      process.env.MONGO_APP_NAME = Command.getMongoConnectionName(
        command,
        parsedArgs.values,
      );
      await this.server.initAllModels();
    } else {
      console.info(`Command ${command} NOT need to isShouldInitModels`);
    }

    const c = new Command(this.app, this.commands, parsedArgs.values);

    const result = await c.run().catch((e: { stack: unknown }) => {
      this.logger?.error(e.stack);
    });

    return result;
  }

  static get loggerGroup() {
    return "CLI_";
  }
}

export default Cli;
