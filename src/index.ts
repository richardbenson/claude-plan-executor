import { Command } from 'commander';

const program = new Command();

program
  .name('cpe')
  .description('Claude Plan Executor — automates planbot → next-phase → summarise-plan')
  .version('0.1.0');

// Subcommands will be registered here in Phase 05 (src/cli.ts)

program.parse();
