#!/usr/bin/env node
import { Command } from "commander";
import { CLI_VERSION } from "./build-info";

const program = new Command();
program
  .name("codex-kaboo")
  .description("Report Codex CLI usage metadata to your codex-kaboo dashboard")
  .version(CLI_VERSION);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
