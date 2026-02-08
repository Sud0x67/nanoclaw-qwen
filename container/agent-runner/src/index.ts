/**
 * NanoClaw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 */

import fs from 'fs';
import { query, type SDKUserMessage } from '@qwen-code/sdk';
import { createIpcMcp } from './ipc-mcp.js';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
}

interface AgentResponse {
  outputType: 'message' | 'log';
  userMessage?: string;
  internalLog?: string;
}

const AGENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    outputType: {
      type: 'string',
      enum: ['message', 'log'],
      description: '"message": the userMessage field contains a message to send to the user or group. "log": the output will not be sent to the user or group.',
    },
    userMessage: {
      type: 'string',
      description: 'A message to send to the user or group. Include when outputType is "message".',
    },
    internalLog: {
      type: 'string',
      description: 'Information that will be logged internally but not sent to the user or group.',
    },
  },
  required: ['outputType'],
} as const;

interface ContainerOutput {
  status: 'success' | 'error';
  result: AgentResponse | null;
  newSessionId?: string;
  error?: string;
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}


async function main(): Promise<void> {
  let input: ContainerInput;

  try {
    const stdinData = await readStdin();
    input = JSON.parse(stdinData);
    log(`Received input for group: ${input.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  const ipcMcp = createIpcMcp({
    chatJid: input.chatJid,
    groupFolder: input.groupFolder,
    isMain: input.isMain
  });

  let result: AgentResponse | null = null;
  let newSessionId: string | undefined;

  // Add context for scheduled tasks
  let prompt = input.prompt;
  if (input.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${input.prompt}`;
  }

  // Load global CLAUDE.md as additional system context (shared across all groups)
  const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
  let globalClaudeMd: string | undefined;
  if (!input.isMain && fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }

  const outputInstructions = [
    'You must respond with a single JSON object and nothing else.',
    'Schema: {"outputType":"message"|"log","userMessage"?:string,"internalLog"?:string}.',
    'If you want to send a message to the user or group, set outputType="message" and include userMessage.',
    'Otherwise set outputType="log" and optionally include internalLog.'
  ].join(' ');

  const systemContext = globalClaudeMd
    ? `\n\n[GLOBAL CONTEXT]\n${globalClaudeMd}\n`
    : '';

  const fullPrompt = `${prompt}${systemContext}\n\n${outputInstructions}`;

  const resumeSessionId = input.sessionId;
  const promptInput: string | AsyncIterable<SDKUserMessage> = resumeSessionId
    ? (async function* (): AsyncIterable<SDKUserMessage> {
        yield {
          type: 'user',
          session_id: resumeSessionId,
          message: { role: 'user', content: fullPrompt },
          parent_tool_use_id: null
        };
      })()
    : fullPrompt;

  try {
    log('Starting agent...');

    for await (const message of query({
      prompt: promptInput,
      options: {
        cwd: '/workspace/group',
        allowedTools: [
          'Bash',
          'Read', 'Write', 'Edit', 'Glob', 'Grep',
          'WebSearch', 'WebFetch',
          'mcp__nanoclaw__*'
        ],
        permissionMode: 'yolo',
        mcpServers: {
          nanoclaw: ipcMcp
        }
      }
    })) {
      if (message.type === 'system' && !newSessionId) {
        newSessionId = message.session_id;
        log(`Session initialized: ${newSessionId}`);
      }

      if (message.type === 'result') {
        if (message.subtype === 'success') {
          const textResult = message.result;
          let parsed: AgentResponse | null = null;
          try {
            parsed = JSON.parse(textResult) as AgentResponse;
          } catch {
            // Try to extract JSON object if the model wrapped output with extra text
            const start = textResult.indexOf('{');
            const end = textResult.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
              try {
                parsed = JSON.parse(textResult.slice(start, end + 1)) as AgentResponse;
              } catch {
                parsed = null;
              }
            }
          }

          if (parsed && parsed.outputType) {
            result = parsed;
            if (result.outputType === 'message' && !result.userMessage) {
              log('Warning: outputType is "message" but userMessage is missing, treating as "log"');
              result = { outputType: 'log', internalLog: result.internalLog };
            }
            log(`Agent result: outputType=${result.outputType}${result.internalLog ? `, log=${result.internalLog}` : ''}`);
          } else {
            log('Structured JSON output missing or invalid, falling back to raw text');
            result = textResult
              ? { outputType: 'message', userMessage: textResult }
              : { outputType: 'log' };
          }
        } else {
          const errorMsg = message.error?.message ?? `Agent error: ${message.subtype}`;
          log(errorMsg);
          result = { outputType: 'log', internalLog: errorMsg };
        }
      }
    }

    log('Agent completed successfully');
    writeOutput({
      status: 'success',
      result: result ?? { outputType: 'log' },
      newSessionId
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
