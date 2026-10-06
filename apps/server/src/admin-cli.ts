import { runAdmin } from './admin';

const code = await runAdmin(process.argv.slice(2), {
  io: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    async readStdin() {
      if (process.stdin.isTTY) return null;
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    },
  },
});
process.exit(code);
