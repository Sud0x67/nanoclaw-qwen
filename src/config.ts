import fs from 'fs';
import os from 'os';
import path from 'path';

export interface AppConfig {
  assistantName: string;
  telegramBotToken: string;
  qwenApiKey: string;
  containerImage: string;
  containerTimeoutMs: number;
  containerMaxOutputSize: number;
  maxConcurrentContainers: number;
  timezone: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'nanoclaw-qwen');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  assistantName: 'Nana',
  telegramBotToken: '',
  qwenApiKey: '',
  containerImage: 'nanoclaw-qwen-agent:latest',
  containerTimeoutMs: 300000,
  containerMaxOutputSize: 10485760,
  maxConcurrentContainers: 5,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  logLevel: 'info',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('Config JSON is not an object');
    }

    return {
      assistantName:
        typeof parsed.assistantName === 'string'
          ? parsed.assistantName
          : DEFAULT_CONFIG.assistantName,
      telegramBotToken:
        typeof parsed.telegramBotToken === 'string'
          ? parsed.telegramBotToken
          : DEFAULT_CONFIG.telegramBotToken,
      qwenApiKey:
        typeof parsed.qwenApiKey === 'string'
          ? parsed.qwenApiKey
          : DEFAULT_CONFIG.qwenApiKey,
      containerImage:
        typeof parsed.containerImage === 'string'
          ? parsed.containerImage
          : DEFAULT_CONFIG.containerImage,
      containerTimeoutMs:
        typeof parsed.containerTimeoutMs === 'number'
          ? parsed.containerTimeoutMs
          : DEFAULT_CONFIG.containerTimeoutMs,
      containerMaxOutputSize:
        typeof parsed.containerMaxOutputSize === 'number'
          ? parsed.containerMaxOutputSize
          : DEFAULT_CONFIG.containerMaxOutputSize,
      maxConcurrentContainers:
        typeof parsed.maxConcurrentContainers === 'number'
          ? parsed.maxConcurrentContainers
          : DEFAULT_CONFIG.maxConcurrentContainers,
      timezone:
        typeof parsed.timezone === 'string'
          ? parsed.timezone
          : DEFAULT_CONFIG.timezone,
      logLevel:
        typeof parsed.logLevel === 'string'
          ? (parsed.logLevel as AppConfig['logLevel'])
          : DEFAULT_CONFIG.logLevel,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error reading config';
    console.warn(
      `Config read failed (${message}). Using defaults. Expected config at ${CONFIG_PATH}`,
    );
    return DEFAULT_CONFIG;
  }
}

const CONFIG = loadConfig();

export const ASSISTANT_NAME = CONFIG.assistantName;
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;
export const TELEGRAM_BOT_TOKEN = CONFIG.telegramBotToken;
export const QWEN_API_KEY = CONFIG.qwenApiKey;
export const TELEGRAM_ENABLED = TELEGRAM_BOT_TOKEN.length > 0;
export const LOG_LEVEL = CONFIG.logLevel;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw-qwen',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE = CONFIG.containerImage;
export const CONTAINER_TIMEOUT = CONFIG.containerTimeoutMs;
export const CONTAINER_MAX_OUTPUT_SIZE = CONFIG.containerMaxOutputSize; // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  CONFIG.maxConcurrentContainers || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE = CONFIG.timezone;
