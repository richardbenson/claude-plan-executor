const HEIGHT = 5;
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export interface LiveBox {
  addLine(line: string): void;
  close(): void;
}

const NOOP: LiveBox = { addLine: () => {}, close: () => {} };

export function openLiveBox(): LiveBox {
  if (!process.stdout.isTTY) return NOOP;

  const buf: string[] = [];
  let drawn = 0;

  function redraw(): void {
    const cols = (process.stdout.columns ?? 80) - 6;
    if (drawn) process.stdout.write(`\x1b[${drawn}A`);
    const rows = [
      ...Array(Math.max(0, HEIGHT - buf.length)).fill(''),
      ...buf,
    ].slice(-HEIGHT);
    for (const row of rows) {
      process.stdout.write(
        `\x1b[2K    \x1b[2m│\x1b[0m ${row.replace(ANSI_RE, '').slice(0, cols)}\n`,
      );
    }
    drawn = HEIGHT;
  }

  redraw(); // reserve lines immediately

  return {
    addLine(line: string): void {
      buf.push(line);
      redraw();
    },
    close(): void {
      if (!drawn) return;
      process.stdout.write(`\x1b[${drawn}A`);
      for (let i = 0; i < drawn; i++) process.stdout.write('\x1b[2K\n');
      process.stdout.write(`\x1b[${drawn}A`);
      drawn = 0;
    },
  };
}
