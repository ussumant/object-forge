import { spawn } from 'node:child_process';

const commands = [
  ['run', 'dev', '-w', '@img3d/server'],
  ['run', 'dev', '-w', '@img3d/web'],
];
const children = commands.map((args) => spawn('npm', args, {
  env: process.env,
  stdio: 'inherit',
}));

let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.once('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.once('exit', (code, signal) => {
    if (!stopping && (code !== 0 || signal)) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
}
