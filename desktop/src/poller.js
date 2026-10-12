const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

/* powershell.exe is an outside process: it cannot read a file inside app.asar,
   which is a virtual filesystem only Electron's own fs knows about. The build
   leaves the .ps1 sidecars unpacked (asarUnpack in package.json) and this
   points at that copy. Outside a packaged build the path is unchanged. */
const sidecar = (name) =>
  path.join(
    __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`),
    name
  );

// Polls the foreground window via a persistent PowerShell sidecar
// (no native npm modules needed). Emits 'sample' with {title, process}.
function startPoller() {
  const emitter = new EventEmitter();
  const script = sidecar('active-window.ps1');
  let ps = null;
  let stopped = false;

  function launch() {
    ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let buf = '';
    ps.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          emitter.emit('sample', JSON.parse(line));
        } catch {}
      }
    });

    ps.on('exit', () => {
      if (!stopped) setTimeout(launch, 3000); // sidecar died — restart it
    });
  }

  launch();

  emitter.stop = () => {
    stopped = true;
    try { ps.kill(); } catch {}
  };
  return emitter;
}

// Persistent PowerShell process that executes window commands sent via stdin
// ("minimize <hwnd>" / "focus <hwnd>"), and answers the two that have answers
// ("activate", "list") with a JSON line carrying the question's id.
function startEnforcer() {
  const script = sidecar('enforcer.ps1');
  let ps = null;
  let stopped = false;
  let nextId = 1;
  const waiting = new Map(); // id -> resolve

  function launch() {
    ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    let buf = '';
    ps.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const done = waiting.get(String(msg.id));
          if (done) { waiting.delete(String(msg.id)); done(msg); }
        } catch {}
      }
    });
    ps.on('exit', () => {
      // Nobody is going to answer the questions in flight.
      for (const done of waiting.values()) done(null);
      waiting.clear();
      if (!stopped) setTimeout(launch, 3000);
    });
  }

  launch();

  return {
    send(line) {
      try { ps.stdin.write(line + '\n'); } catch {}
    },
    // Resolves with the answer, or null after `ms` — a caller never hangs on it.
    ask(cmd, arg = '', ms = 4000) {
      const id = String(nextId++);
      return new Promise((resolve) => {
        const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, ms);
        waiting.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
        try { ps.stdin.write(`${cmd} ${id}${arg ? ` ${arg}` : ''}\n`); } catch { clearTimeout(timer); waiting.delete(id); resolve(null); }
      });
    },
    stop() {
      stopped = true;
      try { ps.kill(); } catch {}
    }
  };
}

module.exports = { startPoller, startEnforcer };
