import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { ImportPersonalAccountsDto } from './dto/import-personal-accounts.dto';
import { SyncService, type MobileSyncAccountDto } from './sync.service';

const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const MAX_IMPORT_ACCOUNTS = 1000;
const NESTED_AUTH_KEYS = [
  'auth',
  'auth_json',
  'authJson',
  'session',
  'session_json',
  'sessionJson',
] as const;

type JsonObject = Record<string, unknown>;

interface ImportMetadata {
  note?: string;
  expiresAt?: string;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function objectValue(value: unknown) {
  return isObject(value) ? value : undefined;
}

function parsedObject(value: unknown) {
  if (isObject(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    return objectValue(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function valueAtPath(source: JsonObject, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    current = objectValue(current)?.[key];
  }
  return current;
}

function firstString(source: JsonObject, paths: string[][]) {
  for (const path of paths) {
    const value = stringValue(valueAtPath(source, path));
    if (value) return value;
  }
  return undefined;
}

function unpack(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) throw new BadRequestException('导入内容必须是 JSON 对象或数组');
  return Array.isArray(value.accounts) ? value.accounts : [value];
}

export function parsePersonalAccountImport(content: string): unknown[] {
  const normalized = content.replace(/^\uFEFF/, '').trim();
  if (!normalized) throw new BadRequestException('导入内容为空');
  try {
    return unpack(JSON.parse(normalized) as unknown);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length || lines.length > MAX_IMPORT_ACCOUNTS) {
      throw new BadRequestException('导入内容不是有效的 JSON');
    }
    const values = lines.map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new BadRequestException('导入内容不是有效的 JSON');
      }
    });
    return values.flatMap(unpack);
  }
}

function findAuth(value: unknown, depth = 0): JsonObject {
  const candidate = parsedObject(value);
  if (!candidate || depth > 8) throw new BadRequestException('账号格式无效');
  for (const key of NESTED_AUTH_KEYS) {
    const nested = parsedObject(candidate[key]);
    if (nested) return findAuth(nested, depth + 1);
  }
  return candidate;
}

function normalizeAgentIdentity(source: JsonObject, credentials?: JsonObject) {
  const identitySource = credentials ?? objectValue(source.agent_identity);
  if (!identitySource) return undefined;
  const identity: JsonObject = {};
  for (const key of [
    'agent_runtime_id',
    'agent_private_key',
    'account_id',
    'chatgpt_account_id',
    'chatgpt_user_id',
    'task_id',
    'email',
    'plan_type',
  ]) {
    const value = stringValue(identitySource[key]);
    if (value) identity[key] = value;
  }
  identity.chatgpt_account_is_fedramp = identitySource.chatgpt_account_is_fedramp === true;
  return { auth_mode: 'agentIdentity', agent_identity: identity };
}

function tokenPaths(snakeName: string, camelName: string) {
  return [
    [snakeName],
    [camelName],
    ['tokens', snakeName],
    ['tokens', camelName],
    ['token', snakeName],
    ['token', camelName],
    ['credentials', snakeName],
    ['credentials', camelName],
  ];
}

export function normalizePersonalAccountAuth(value: unknown): JsonObject {
  const source = findAuth(value);
  const credentials = objectValue(source.credentials);
  const authMode = stringValue(credentials?.auth_mode ?? source.auth_mode)?.toLowerCase();
  if (authMode === 'agentidentity' || source.agent_identity) {
    const identitySource = authMode === 'agentidentity' ? credentials : undefined;
    const normalized = normalizeAgentIdentity(source, identitySource);
    if (normalized) return normalized;
  }

  const accessToken = firstString(source, tokenPaths('access_token', 'accessToken'));
  const refreshToken = firstString(source, tokenPaths('refresh_token', 'refreshToken'));
  const idToken = firstString(source, tokenPaths('id_token', 'idToken'));
  const sessionToken = firstString(source, tokenPaths('session_token', 'sessionToken'));
  if (!accessToken && !refreshToken && !sessionToken) {
    throw new BadRequestException('没有找到 Codex 登录凭据');
  }

  const tokens: JsonObject = {};
  if (accessToken) tokens.access_token = accessToken;
  if (refreshToken) tokens.refresh_token = refreshToken;
  if (idToken) tokens.id_token = idToken;
  if (sessionToken) tokens.session_token = sessionToken;
  for (const [target, paths] of Object.entries({
    account_id: [['account_id'], ['chatgpt_account_id'], ['credentials', 'chatgpt_account_id']],
    chatgpt_user_id: [['chatgpt_user_id'], ['user_id'], ['credentials', 'chatgpt_user_id']],
    email: [['email'], ['credentials', 'email']],
    plan_type: [['plan_type'], ['credentials', 'plan_type']],
    organization_id: [['organization_id'], ['credentials', 'organization_id']],
    expires_at: [['expires_at'], ['credentials', 'expires_at']],
  })) {
    const identityValue = firstString(source, paths);
    if (identityValue) tokens[target] = identityValue;
  }
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens,
    last_refresh: new Date().toISOString(),
  };
}

function importMetadata(value: unknown): ImportMetadata {
  const source = objectValue(value) ?? {};
  return {
    note: firstString(source, [['note'], ['remark'], ['description']]),
    expiresAt: firstString(source, [['expiresAt'], ['expires_at'], ['expiration']]),
  };
}

function token(auth: JsonObject, name: string) {
  return stringValue(objectValue(auth.tokens)?.[name]);
}

@Injectable()
export class PersonalAccountImportService {
  constructor(private readonly sync: SyncService) {}

  async import(actor: AuthUser, dto: ImportPersonalAccountsDto) {
    const values = parsePersonalAccountImport(dto.content);
    if (values.length > MAX_IMPORT_ACCOUNTS) {
      throw new BadRequestException(`单次最多导入 ${MAX_IMPORT_ACCOUNTS} 个账号`);
    }
    const accounts: MobileSyncAccountDto[] = [];
    const skipped: string[] = [];
    for (const [index, value] of values.entries()) {
      try {
        accounts.push(await this.importOne(actor, dto, value));
      } catch (error) {
        const detail = error instanceof HttpException ? error.message : '账号导入失败';
        skipped.push(`第 ${index + 1} 个账号：${detail}`);
      }
    }
    if (!accounts.length) throw new BadRequestException(skipped[0] ?? '没有可导入的账号');
    return { accounts, importedCount: accounts.length, skippedCount: skipped.length, skipped };
  }

  private async importOne(actor: AuthUser, dto: ImportPersonalAccountsDto, value: unknown) {
    let auth = normalizePersonalAccountAuth(value);
    if (!token(auth, 'access_token')) auth = await this.refresh(auth);
    const account = await this.sync.upsertPersonalAccountFromAuth(actor.id, auth);
    const metadata = importMetadata(value);
    if (account.official || (!dto.note && !dto.expiresAt && !metadata.note && !metadata.expiresAt)) {
      return account;
    }
    return this.sync.updateAccountDetails(actor.id, account.id, {
      note: dto.note ?? metadata.note ?? account.note,
      expiresAt: dto.expiresAt ?? metadata.expiresAt ?? account.expiresAt,
      privateDetails: account.privateDetails ?? { password: '', phoneNumber: '', totpSecret: '' },
    });
  }

  private async refresh(auth: JsonObject) {
    const refreshToken = token(auth, 'refresh_token');
    if (!refreshToken) throw new BadRequestException('账号凭据缺少 access_token 或 refresh_token');
    let response: Response;
    try {
      response = await fetch(OPENAI_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', originator: 'codex_cli_rs' },
        body: JSON.stringify({
          client_id: OPENAI_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new BadGatewayException('无法连接 Codex 登录服务刷新账号凭据');
    }
    if (!response.ok) throw new BadGatewayException(`账号凭据刷新失败（HTTP ${response.status}）`);
    const payload = await response.json().catch(() => null) as JsonObject | null;
    const accessToken = stringValue(payload?.access_token);
    if (!accessToken) throw new BadGatewayException('刷新响应缺少 access_token');
    const tokens: JsonObject = { ...(objectValue(auth.tokens) ?? {}), access_token: accessToken };
    for (const key of ['id_token', 'refresh_token'] as const) {
      const nextToken = stringValue(payload?.[key]);
      if (nextToken) tokens[key] = nextToken;
    }
    return { ...auth, tokens };
  }
}
