type RunCommand = {
  type: "run";
  runId: string;
  sessionId: string;
  prompt: string;
  mode: "plan" | "ask" | "auto";
  repositoryPath: string;
  workingDirectory?: string;
};

type PermissionResponse = {
  type: "permission_response";
  requestId: string;
  decision: "approved" | "rejected";
};

const args = Bun.argv.slice(2);
function argument(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredArgument(name: string) {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const socketUrl = requiredArgument("--socket-url");
const token = requiredArgument("--token");

const pendingPermissions = new Map<string, (approved: boolean) => void>();
let socket: WebSocket;

function send(payload: Record<string, unknown>) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function sendEvent(
  command: RunCommand,
  eventType: string,
  input: {
    content?: string;
    role?: string;
    payload?: Record<string, unknown>;
  },
) {
  send({
    type: "event",
    sessionId: command.sessionId,
    runId: command.runId,
    eventType,
    ...input,
  });
}

function sendStatus(command: RunCommand, value: string, content?: string) {
  send({
    type: "status",
    sessionId: command.sessionId,
    runId: command.runId,
    status: value,
    content,
  });
}

function commandFromPrompt(prompt: string, mode: RunCommand["mode"]) {
  const trimmed = prompt.trim();
  if (trimmed.startsWith("$ ")) return trimmed.slice(2);
  if (/\b(run|execute)\s+(the\s+)?tests?\b/i.test(trimmed)) return "bun test";
  if (/\btype\s*check\b/i.test(trimmed)) return "bun run typecheck";
  if (/\b(build|compile)\b/i.test(trimmed)) return "bun run build";
  if (/\b(diff|changes?)\b/i.test(trimmed)) return "git diff --stat && git diff";
  if (/\b(status|what changed)\b/i.test(trimmed)) return "git status --short";
  const quotedPrompt = `'${trimmed.replaceAll("'", `'"'"'`)}'`;
  const sandbox = mode === "plan" ? "read-only" : "workspace-write";
  return `codex exec --sandbox ${sandbox} --skip-git-repo-check --color never ${quotedPrompt}`;
}

function isReadOnly(command: string) {
  return [
    /^pwd\b/,
    /^ls\b/,
    /^find\b/,
    /^rg\b/,
    /^sed\s+-n\b/,
    /^git\s+(status|diff|log|show|branch)\b/,
    /^bun\s+(test|run\s+(typecheck|check|build))\b/,
    /^codex\s+exec\s+--sandbox\s+read-only\b/,
  ].some((pattern) => pattern.test(command.trim()));
}

async function canonicalDirectory(repositoryPath: string, workingDirectory?: string) {
  const repository = await Bun.$`realpath ${repositoryPath}`.quiet().text();
  const directoryPath = workingDirectory || repositoryPath;
  const directory = await Bun.$`realpath ${directoryPath}`.quiet().text();
  const normalizedRepository = repository.trim();
  const normalizedDirectory = directory.trim();
  if (
    normalizedDirectory !== normalizedRepository &&
    !normalizedDirectory.startsWith(`${normalizedRepository}/`)
  ) {
    throw new Error("Working directory must stay inside the bound repository");
  }
  return normalizedDirectory;
}

async function requestPermission(command: RunCommand, shellCommand: string, cwd: string) {
  const requestId = crypto.randomUUID();
  send({
    type: "permission_request",
    requestId,
    sessionId: command.sessionId,
    runId: command.runId,
    command: shellCommand,
    workingDirectory: cwd,
  });
  return new Promise<boolean>((resolve) => {
    pendingPermissions.set(requestId, resolve);
    setTimeout(
      () => {
        if (pendingPermissions.delete(requestId)) resolve(false);
      },
      15 * 60 * 1000,
    );
  });
}

async function execute(command: RunCommand) {
  sendStatus(command, "running");
  try {
    const cwd = await canonicalDirectory(command.repositoryPath, command.workingDirectory);
    const shellCommand = commandFromPrompt(command.prompt, command.mode);
    const readOnly = isReadOnly(shellCommand);
    if (command.mode === "plan" && !readOnly) {
      throw new Error("Plan mode does not allow mutating local commands");
    }
    if (!readOnly && command.mode !== "auto") {
      const approved = await requestPermission(command, shellCommand, cwd);
      if (!approved) throw new Error("Local command was rejected or expired");
      sendStatus(command, "running");
    }

    sendEvent(command, "tool_call", {
      content: shellCommand,
      payload: { command: shellCommand, workingDirectory: cwd, readOnly },
    });
    const childProcess = Bun.spawn(["/bin/zsh", "-lc", shellCommand], {
      cwd,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(childProcess.stdout).text(),
      new Response(childProcess.stderr).text(),
      childProcess.exited,
    ]);
    const combined = [stdout, stderr].filter(Boolean).join("\n").slice(0, 100_000);
    sendEvent(command, "tool_result", {
      content: combined || `Command exited with code ${exitCode}`,
      payload: { command: shellCommand, exitCode },
    });

    const diffProcess = Bun.spawn(["git", "diff", "--no-ext-diff", "--", "."], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const diff = (await new Response(diffProcess.stdout).text()).slice(0, 150_000);
    await diffProcess.exited;
    if (diff) {
      sendEvent(command, "diff", { content: diff, payload: { workingDirectory: cwd } });
    }

    const summary =
      exitCode === 0
        ? `Local command completed successfully:\n\n${shellCommand}`
        : `Local command failed with exit code ${exitCode}:\n\n${shellCommand}`;
    sendEvent(command, "message", { role: "assistant", content: summary });
    sendStatus(
      command,
      exitCode === 0 ? "completed" : "failed",
      exitCode === 0 ? undefined : summary,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local coding run failed";
    sendEvent(command, "message", { role: "assistant", content: message });
    sendStatus(command, "failed", message);
  }
}

function connect(delay = 500) {
  const url = new URL(socketUrl);
  url.searchParams.set("token", token);
  socket = new WebSocket(url);
  socket.addEventListener("open", () => console.log("home sidecar connected"));
  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(String(message.data)) as
      | RunCommand
      | PermissionResponse
      | { type: string };
    if (payload.type === "run") void execute(payload as RunCommand);
    if (payload.type === "permission_response") {
      const response = payload as PermissionResponse;
      const resolve = pendingPermissions.get(response.requestId);
      if (resolve) {
        pendingPermissions.delete(response.requestId);
        resolve(response.decision === "approved");
      }
    }
  });
  socket.addEventListener("close", () =>
    setTimeout(() => connect(Math.min(delay * 2, 15_000)), delay),
  );
  socket.addEventListener("error", () => socket.close());
}

connect();
