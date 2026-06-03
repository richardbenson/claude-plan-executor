import { program } from 'commander';
import { CPE_VERSION } from './version.js';
import { planCommand } from './commands/plan.js';
import { queueCommand } from './commands/queue.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { listCommand } from './commands/list.js';
import { removeCommand } from './commands/remove.js';
import { cleanCommand } from './commands/clean.js';
import { bootstrapCommand } from './commands/bootstrap.js';
import { worktreeCommand } from './commands/worktree.js';
import { promptCommand } from './commands/prompt.js';
import { readQueue, writeQueue } from './storage/queue.js';
import {
  providerListCommand,
  providerAddCommand,
  providerRemoveCommand,
  providerTestCommand,
} from './commands/provider.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrap(fn: (...args: any[]) => Promise<void>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  };
}

export function setupCli(): void {
  program
    .name('cpe')
    .description('Claude Plan Executor — automates planbot → next-phase → summarise-plan')
    .version(CPE_VERSION);

  program
    .command('plan [details...]')
    .description('Create a new plan interactively')
    .option('--disable-sandbox', 'Skip sandbox injection for this run')
    .option('--provider <name>', 'Provider to use for this run')
    .option('--model <model>', 'Model to use for this run')
    .option('--harness <name>', 'Harness adapter to use for this run')
    .action(wrap(planCommand));

  program
    .command('queue [folder]')
    .description('Add a plan to the queue')
    .option('--disable-sandbox', 'Skip sandbox injection for this run')
    .option('--provider <name>', 'Provider to use for this run')
    .option('--model <model>', 'Model to use for this run')
    .option('--harness <name>', 'Harness adapter to use for this run')
    .action(wrap(queueCommand));

  program
    .command('prompt [text...]')
    .description('Queue a single-prompt run (pass as args, pipe via stdin, or use --github-issue)')
    .option('--disable-sandbox', 'Skip sandbox injection for this run')
    .option('--github-issue <number>', 'Fetch a GitHub issue by number and use it as the prompt')
    .option('--provider <name>', 'Provider to use for this run')
    .option('--model <model>', 'Model to use for this run')
    .option('--harness <name>', 'Harness adapter to use for this run')
    .action(wrap(promptCommand));

  program
    .command('start')
    .description('Start the TUI / queue processor')
    .action(wrap(startCommand));

  program
    .command('status')
    .description('Print queue status (non-TUI, for scripting)')
    .action(wrap(statusCommand));

  program
    .command('list')
    .description('List runs in queue')
    .action(wrap(listCommand));

  program
    .command('remove <run-id>')
    .description('Remove a run from the queue')
    .action(wrap(removeCommand));

  program
    .command('pause')
    .description('Pause queue processing')
    .action(
      wrap(async () => {
        const queue = readQueue();
        queue.paused = true;
        writeQueue(queue);
        console.log('Queue paused.');
      }),
    );

  program
    .command('resume')
    .description('Resume queue processing')
    .action(
      wrap(async () => {
        const queue = readQueue();
        queue.paused = false;
        writeQueue(queue);
        console.log('Queue resumed.');
      }),
    );

  program
    .command('clean')
    .description('Remove worktrees for completed/merged runs')
    .option('--all', 'Clean all without prompting')
    .action(wrap(cleanCommand));

  program
    .command('worktree')
    .description('Enter a worktree shell for the current repo')
    .option('--all', 'Show worktrees for all repos, not just the current one')
    .action(wrap(worktreeCommand));

  program
    .command('bootstrap')
    .description('Manage per-repo bootstrap config')
    .option('--detect', 'Run LLM-based detection')
    .option('--stub', 'Write an empty template')
    .option('--edit', 'Open cpe.config.json in $EDITOR')
    .action(wrap(bootstrapCommand));

  const providerCmd = program
    .command('provider')
    .description('Manage Claude providers (alternative models / API endpoints)');

  providerCmd
    .command('list')
    .description('List configured providers')
    .action(wrap(providerListCommand));

  providerCmd
    .command('add')
    .description('Add a provider interactively, or from a preset')
    .option('--preset <name>', 'Add a built-in preset (e.g. desktop-ollama) without prompts')
    .action(wrap(providerAddCommand));

  providerCmd
    .command('remove <name>')
    .description('Remove a provider by name')
    .action(wrap(providerRemoveCommand));

  providerCmd
    .command('test [name]')
    .description('Test provider health checks (all providers, or one by name)')
    .action(wrap(providerTestCommand));
}
