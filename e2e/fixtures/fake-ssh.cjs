#!/usr/bin/env node

// Stands in for the OpenSSH client at its process boundary: same argv, same exit codes, the same stderr lines for
// the failures the server reports. Hosts are read from fake-ssh-hosts.json next to this script:
//   { "<target>": { "home": "/remote/home", "env": { "HERDR_SESSION": "..." }, "refuse": "Permission denied ..." } }
// A remote path is a path on this machine, so "remote" herdr is any socket the test serves under that home.

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

const HOSTS_FILE = path.join(__dirname, 'fake-ssh-hosts.json');
const PID_LOG = path.join(__dirname, 'fake-ssh-pids.log');
const OPTIONS_WITH_VALUE = new Set(['-o', '-L', '-p', '-i', '-F']);
const SSH_FAILURE_EXIT_CODE = 255;

function parseArgs(argv) {
  const parsed = { forward: undefined, target: undefined, command: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (!arg.startsWith('-')) break;
    if (OPTIONS_WITH_VALUE.has(arg)) {
      if (arg === '-L') parsed.forward = argv[i + 1];
      i++;
    }
  }
  parsed.target = argv[i];
  parsed.command = argv.slice(i + 1);
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(SSH_FAILURE_EXIT_CODE);
}

function readHosts() {
  try {
    return JSON.parse(fs.readFileSync(HOSTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function forward(spec) {
  const separator = spec.indexOf(':');
  const localPath = spec.slice(0, separator);
  const remotePath = spec.slice(separator + 1);
  let channel = 1;
  const server = net.createServer((local) => {
    channel++;
    const thisChannel = channel;
    const remote = net.connect(remotePath);
    remote.on('error', () => {
      process.stderr.write(`channel ${thisChannel}: open failed: connect failed: open failed\n`);
      local.destroy();
    });
    local.on('error', () => remote.destroy());
    local.pipe(remote);
    remote.pipe(local);
    local.on('close', () => remote.destroy());
    remote.on('close', () => local.destroy());
  });
  const shutDown = () => {
    server.close();
    fs.rmSync(localPath, { force: true });
    process.exit(0);
  };
  process.on('SIGTERM', shutDown);
  process.on('SIGINT', shutDown);
  fs.rmSync(localPath, { force: true });
  server.listen(localPath);
}

const { forward: forwardSpec, target, command } = parseArgs(process.argv.slice(2));
fs.appendFileSync(PID_LOG, `${process.pid} ${target}\n`);
const host = readHosts()[target];
if (!host) fail(`ssh: Could not resolve hostname ${target}: Name or service not known`);
if (host.refuse) fail(host.refuse);

if (command.length > 0) {
  // sshd hands the joined command to the remote login shell, so run it rather than echoing the hosts file.
  const result = spawnSync('/bin/sh', ['-c', command.join(' ')], {
    env: { PATH: process.env.PATH, HOME: host.home, ...(host.env ?? {}) },
    encoding: 'utf8',
  });
  if (result.error) fail(`ssh: ${result.error.message}`);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? SSH_FAILURE_EXIT_CODE);
}
if (forwardSpec) forward(forwardSpec);
