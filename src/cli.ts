import { Command, program } from 'commander';
import { planCommand } from './commands/plan.js';
import { queueCommand } from './commands/queue.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { listCommand } from './commands/list.js';
import { removeCommand } from './commands/remove.js';
import { cleanCommand } from './commands/clean.js';
import { bootstrapCommand } from './commands/bootstrap.js';
import { readQueue, writeQueue } from './storage/queue.js';

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
    .version('0.1.0');

  program
    .command('plan [details...]')
    .description('Create a new plan interactively (Phase 09)')
    .action(wrap(planCommand));

  program
    .command('queue [folder]')
    .description('Add a plan to the queue')
    .action(wrap(queueCommand));

  program
    .command('start')
    .description('Start the TUI / queue processor (Phase 09)')
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
    .command('bootstrap')
    .description('Manage per-repo bootstrap config')
    .option('--detect', 'Run LLM-based detection')
    .option('--stub', 'Write an empty template')
    .option('--edit', 'Open cpe.config.json in $EDITOR')
    .action(wrap(bootstrapCommand));
}
