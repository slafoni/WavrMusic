import { spawn } from 'node:child_process';
import net from 'node:net';
import electronPath from 'electron';

const DEV_URL = 'http://localhost:5173';
const PORT = 5173;

const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });

let child = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { if (child && !child.killed) child.kill(); } catch {}
  try { if (!vite.killed) vite.kill(); } catch {}
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function waitForPort(port, onReady) {
  const attempt = () => {
    if (shuttingDown) return;
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.end();
      onReady();
    });
    socket.once('error', () => setTimeout(attempt, 300));
  };
  attempt();
}

waitForPort(PORT, () => {
  child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: DEV_URL,
    },
  });
  child.on('close', (code) => shutdown(code ?? 0));
});
