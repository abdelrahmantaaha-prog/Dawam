const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

// Polls the foreground window via a persistent PowerShell sidecar
// (no native npm modules needed). Emits 'sample' with {title, process}.
function startPoller() {
  const emitter = new EventEmitter();
  const script = path.join(__dirname, 'active-window.ps1');
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
// ("minimize <hwnd>" / "focus <hwnd>"). Used for force-return.
function startEnforcer() {
  const script = path.join(__dirname, 'enforcer.ps1');
  let ps = null;
  let stopped = false;

  function launch() {
    ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore']
    });
    ps.on('exit', () => {
      if (!stopped) setTimeout(launch, 3000);
    });
  }

  launch();

  return {
    send(line) {
      try { ps.stdin.write(line + '\n'); } catch {}
    },
    stop() {
      stopped = true;
      try { ps.kill(); } catch {}
    }
  };
}

module.exports = { startPoller, startEnforcer };
