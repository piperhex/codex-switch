import { Buffer } from 'buffer';
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { ImportSystemAccountsDto } from './dto/admin-management.dto';
import { AdminService } from './admin.service';

const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEFAULT_ISSUER = 'https://auth.openai.com';
const ORIGINATOR = 'codex_cli_rs';
const MAX_IMPORT_ACCOUNTS = 1000;
const NESTED_AUTH_KEYS = [
  'auth',
  'auth_json',
  'authJson',
  'session',
  'session_json',
  'sessionJson',
] as const;

interface CompatibleTokens {
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  sessionToken?: string;
}

type JsonObject = Record<string, unknown>;

export function parseCompatibleJsonAccounts(content: string): unknown[] {
  const normalized = content.replace(/^\uFEFF/, '').trim();
  if (!normalized) throw new BadRequestException('Import file is empty');

  try {
    return unpackTopLevel(JSON.parse(normalized) as unknown);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const embedded = extractJsonSlices(normalized).flatMap((slice) => {
      try {
        return unpackTopLevel(JSON.parse(slice) as unknown);
      } catch {
        return [];
      }
    });
    if (embedded.length) return embedded;
    return parseLineDelimitedAccounts(normalized, error);
  }
}

export function normalizeCompatibleAuth(value: unknown): JsonObject {
  const account = findCompatibleAccount(value);
  const tokens = account ? extractCompatibleTokens(account, 0) : undefined;
  if (!tokens) {
    throw new BadRequestException(
      'No Codex token found; supported fields include access_token/accessToken, tokens, credentials, session/session_json, and refresh_token',
    );
  }

  const normalizedTokens: JsonObject = {};
  if (tokens.accessToken) normalizedTokens.access_token = tokens.accessToken;
  if (tokens.idToken && isDecodableJwt(tokens.idToken)) normalizedTokens.id_token = tokens.idToken;
  if (tokens.refreshToken && tokens.refreshToken !== '__missing_refresh_token__') {
    normalizedTokens.refresh_token = tokens.refreshToken;
  }
  if (tokens.sessionToken) normalizedTokens.session_token = tokens.sessionToken;
  if (account) copyCompatibleIdentity(account, normalizedTokens);
  enrichTokenIdentity(normalizedTokens);
  return { tokens: normalizedTokens };
}

interface CompatibleMetadata {
  note?: string;
  expiresAt?: string;
}

export function parseSub2apiJsonAccounts(content: string): unknown[] {
  const normalized = content.replace(/^\uFEFF/, '').trim();
  if (!normalized) throw new BadRequestException('Import file is empty');
  let value: unknown;
  try {
    value = JSON.parse(normalized) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid JSON';
    throw new BadRequestException(`Invalid sub2api JSON: ${detail}`);
  }
  if (!isObject(value)) {
    throw new BadRequestException('sub2api export must contain a JSON object at the top level');
  }
  if (value.type !== undefined && value.type !== 'sub2api-data') {
    throw new BadRequestException('The selected file is not a sub2api account export');
  }
  if (value.version !== undefined && value.version !== 1) {
    throw new BadRequestException('Only version 1 sub2api exports are supported');
  }
  if (!Array.isArray(value.accounts) || !value.accounts.length) {
    throw new BadRequestException('The sub2api export does not contain any accounts');
  }
  if (value.accounts.length > MAX_IMPORT_ACCOUNTS) {
    throw new BadRequestException(`A single import supports at most ${MAX_IMPORT_ACCOUNTS} accounts`);
  }
  return value.accounts;
}

export function normalizeSub2apiAuth(value: unknown): JsonObject {
  if (!isObject(value)) throw new BadRequestException('sub2api account must be a JSON object');
  if (value.platform !== 'openai' || value.type !== 'oauth') {
    throw new BadRequestException('Only platform=openai and type=oauth accounts are supported');
  }
  const credentials = isObject(value.credentials) ? value.credentials : undefined;
  if (!credentials) throw new BadRequestException('sub2api account is missing credentials');
  const authMode = firstString(credentials, [['auth_mode']]);
  if (authMode?.toLowerCase() !== 'agentidentity') {
    const accessToken = firstString(credentials, [['access_token']]);
    if (!accessToken) throw new BadRequestException('sub2api credentials is missing access_token');
    const tokens: JsonObject = {
      access_token: accessToken,
      id_token: firstString(credentials, [['id_token']]) ?? '',
      refresh_token: firstString(credentials, [['refresh_token']]) ?? '',
    };
    for (const [source, target] of [
      ['chatgpt_account_id', 'account_id'],
      ['chatgpt_user_id', 'chatgpt_user_id'],
      ['email', 'email'],
      ['plan_type', 'plan_type'],
      ['organization_id', 'organization_id'],
      ['expires_at', 'expires_at'],
    ] as const) {
      const field = firstString(credentials, [[source]]);
      if (field) tokens[target] = field;
    }
    return {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens,
      last_refresh: new Date().toISOString(),
    };
  }

  const identity: JsonObject = {};
  for (const key of ['agent_runtime_id', 'agent_private_key', 'account_id', 'chatgpt_user_id']) {
    const field = firstString(credentials, [[key]]);
    if (!field) throw new BadRequestException(`sub2api credentials is missing ${key}`);
    identity[key] = field;
  }
  const privateKey = identity.agent_private_key as string;
  const normalizedKey = privateKey.replace(/\s+/g, '').replace(/=+$/, '');
  const decodedKey = Buffer.from(privateKey, 'base64');
  if (decodedKey.length < 32 || decodedKey.toString('base64').replace(/=+$/, '') !== normalizedKey) {
    throw new BadRequestException('sub2api agent_private_key is not valid Base64');
  }
  for (const key of ['task_id', 'email', 'plan_type']) {
    const field = firstString(credentials, [[key]]);
    if (field) identity[key] = field;
  }
  identity.chatgpt_account_is_fedramp = credentials.chatgpt_account_is_fedramp === true;

  return {
    auth_mode: 'agentIdentity',
    agent_identity: identity,
  };
}

function unpackTopLevel(value: unknown): unknown[] {
  if (!isObject(value) && !Array.isArray(value)) {
    throw new BadRequestException('Import file must contain a JSON object or array at the top level');
  }
  const found = collectCompatibleAccounts(value);
  if (!found.length) throw new BadRequestException('Import file does not contain any accounts');
  if (found.length > MAX_IMPORT_ACCOUNTS) {
    throw new BadRequestException(`A single import supports at most ${MAX_IMPORT_ACCOUNTS} accounts`);
  }
  return found;
}

function parseLineDelimitedAccounts(content: string, parseError: SyntaxError): unknown[] {
  const lines = content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0);
  if (lines.length <= 1) {
    throw new BadRequestException(`Invalid JSON: ${parseError.message}`);
  }
  if (lines.length > MAX_IMPORT_ACCOUNTS) {
    throw new BadRequestException(`A single import supports at most ${MAX_IMPORT_ACCOUNTS} accounts`);
  }
  return lines.map(({ line, lineNumber }) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid JSON';
      throw new BadRequestException(`Line ${lineNumber} is not valid JSON: ${detail}`);
    }
    if (!isObject(value)) {
      throw new BadRequestException(`Line ${lineNumber} must contain a JSON object`);
    }
    return value;
  });
}

function extractCompatibleTokens(value: unknown, depth: number): CompatibleTokens | undefined {
  if (depth > 4 || !isObject(value)) return undefined;
  const tokens = {
    idToken: firstString(value, [
      ['id_token'], ['idToken'], ['tokens', 'id_token'], ['tokens', 'idToken'],
      ['token', 'id_token'], ['token', 'idToken'],
      ['credentials', 'id_token'], ['credentials', 'idToken'],
    ]),
    accessToken: firstString(value, [
      ['access_token'], ['accessToken'], ['tokens', 'access_token'], ['tokens', 'accessToken'],
      ['token', 'access_token'], ['token', 'accessToken'],
      ['credentials', 'access_token'], ['credentials', 'accessToken'],
    ]),
    refreshToken: firstString(value, [
      ['refresh_token'], ['refreshToken'], ['tokens', 'refresh_token'], ['tokens', 'refreshToken'],
      ['token', 'refresh_token'], ['token', 'refreshToken'],
      ['credentials', 'refresh_token'], ['credentials', 'refreshToken'],
    ]),
    sessionToken: firstString(value, [
      ['session_token'], ['sessionToken'], ['tokens', 'session_token'], ['tokens', 'sessionToken'],
      ['token', 'session_token'], ['token', 'sessionToken'], ['credentials', 'session_token'],
    ]),
  };
  if (tokens.idToken || tokens.accessToken || tokens.refreshToken || tokens.sessionToken) return tokens;

  for (const key of NESTED_AUTH_KEYS) {
    const nested = value[key];
    if (isObject(nested)) {
      const result = extractCompatibleTokens(nested, depth + 1);
      if (result) return result;
    } else if (typeof nested === 'string') {
      try {
        const result = extractCompatibleTokens(JSON.parse(nested) as unknown, depth + 1);
        if (result) return result;
      } catch {
        // Another supported wrapper may still contain a usable session.
      }
    }
  }
  return undefined;
}

function findCompatibleAccount(value: unknown) {
  return collectCompatibleAccounts(value)[0];
}

function collectCompatibleAccounts(value: unknown, depth = 0, found: JsonObject[] = []) {
  if (depth > 12 || found.length > MAX_IMPORT_ACCOUNTS) return found;
  if (Array.isArray(value)) {
    for (const item of value) collectCompatibleAccounts(item, depth + 1, found);
    return found;
  }
  if (!isObject(value)) return found;
  if (hasDirectCompatibleToken(value)) {
    found.push(value);
    return found;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (['accessToken', 'access_token', 'sessionToken'].includes(key)) continue;
    if (typeof nested === 'string' && NESTED_AUTH_KEYS.includes(key as typeof NESTED_AUTH_KEYS[number])) {
      try {
        collectCompatibleAccounts(JSON.parse(nested) as unknown, depth + 1, found);
      } catch {
        // Continue scanning other supported wrappers.
      }
    } else {
      collectCompatibleAccounts(nested, depth + 1, found);
    }
  }
  return found;
}

function hasDirectCompatibleToken(value: JsonObject) {
  return Boolean(firstString(value, [
    ['id_token'], ['idToken'], ['access_token'], ['accessToken'], ['refresh_token'], ['refreshToken'],
    ['tokens', 'id_token'], ['tokens', 'idToken'], ['tokens', 'access_token'], ['tokens', 'accessToken'],
    ['tokens', 'refresh_token'], ['tokens', 'refreshToken'],
    ['token', 'id_token'], ['token', 'idToken'], ['token', 'access_token'], ['token', 'accessToken'],
    ['token', 'refresh_token'], ['token', 'refreshToken'],
    ['credentials', 'id_token'], ['credentials', 'idToken'],
    ['credentials', 'access_token'], ['credentials', 'accessToken'],
    ['credentials', 'refresh_token'], ['credentials', 'refreshToken'],
  ]));
}

function copyCompatibleIdentity(value: JsonObject, tokens: JsonObject) {
  const mappings: Array<[string, string[][]]> = [
    ['account_id', [
      ['account', 'id'], ['account_id'], ['chatgptAccountId'], ['chatgpt_account_id'],
      ['tokens', 'accountId'], ['tokens', 'account_id'], ['tokens', 'chatgptAccountId'],
      ['tokens', 'chatgpt_account_id'], ['token', 'accountId'], ['token', 'account_id'],
      ['token', 'chatgptAccountId'], ['token', 'chatgpt_account_id'],
      ['credentials', 'chatgpt_account_id'], ['providerSpecificData', 'chatgptAccountId'],
      ['providerSpecificData', 'chatgpt_account_id'], ['meta', 'chatgptAccountId'],
      ['meta', 'chatgpt_account_id'],
    ]],
    ['chatgpt_user_id', [
      ['user', 'id'], ['user_id'], ['chatgptUserId'], ['chatgpt_user_id'],
      ['tokens', 'userId'], ['tokens', 'user_id'], ['tokens', 'chatgptUserId'],
      ['tokens', 'chatgpt_user_id'], ['token', 'userId'], ['token', 'user_id'],
      ['token', 'chatgptUserId'], ['token', 'chatgpt_user_id'], ['credentials', 'chatgpt_user_id'],
      ['providerSpecificData', 'chatgptUserId'], ['providerSpecificData', 'chatgpt_user_id'],
    ]],
    ['email', [
      ['user', 'email'], ['email'], ['label'], ['meta', 'label'],
      ['credentials', 'email'], ['providerSpecificData', 'email'],
    ]],
    ['plan_type', [
      ['account', 'planType'], ['account', 'plan_type'], ['planType'], ['plan_type'],
      ['credentials', 'plan_type'], ['providerSpecificData', 'chatgptPlanType'],
      ['providerSpecificData', 'chatgpt_plan_type'],
    ]],
    ['organization_id', [
      ['organizationId'], ['organization_id'], ['meta', 'organizationId'], ['meta', 'organization_id'],
      ['credentials', 'organization_id'], ['providerSpecificData', 'organizationId'],
      ['providerSpecificData', 'organization_id'],
    ]],
    ['expires_at', [
      ['expires'], ['expiresAt'], ['expires_at'], ['expired'], ['credentials', 'expires_at'],
    ]],
    ['workspace_id', [
      ['account', 'workspaceId'], ['account', 'workspace_id'], ['workspaceId'], ['workspace_id'],
      ['meta', 'workspaceId'], ['meta', 'workspace_id'], ['credentials', 'workspace_id'],
      ['providerSpecificData', 'workspaceId'], ['providerSpecificData', 'workspace_id'],
    ]],
  ];
  for (const [target, paths] of mappings) {
    const field = firstString(value, paths);
    if (field) tokens[target] = field;
  }
  if (value.provider === 'codex' && !tokens.account_id) {
    const id = firstString(value, [['id']]);
    if (id) tokens.account_id = id;
  }
}

function enrichTokenIdentity(tokens: JsonObject) {
  const token = firstString(tokens, [['id_token'], ['access_token']]);
  if (!token) return;
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return;
  let claims: JsonObject;
  try {
    const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as unknown;
    claims = isObject(decoded) ? decoded : {};
  } catch {
    return;
  }
  const auth = isObject(claims['https://api.openai.com/auth'])
    ? claims['https://api.openai.com/auth'] as JsonObject
    : {};
  const profile = isObject(claims['https://api.openai.com/profile'])
    ? claims['https://api.openai.com/profile'] as JsonObject
    : {};
  const organization = Array.isArray(auth.organizations)
    ? auth.organizations.find((value) => isObject(value) && firstString(value, [['id']]))
    : undefined;
  const values: Array<[string, string | undefined]> = [
    ['account_id', firstString(auth, [['chatgpt_account_id']])],
    ['chatgpt_user_id', firstString(auth, [['chatgpt_user_id'], ['user_id']])
      ?? firstString(claims, [['sub']])],
    ['email', firstString(claims, [['email']]) ?? firstString(profile, [['email']])],
    ['plan_type', firstString(auth, [['chatgpt_plan_type']])],
    ['organization_id', firstString(auth, [['organization_id']])
      ?? (isObject(organization) ? firstString(organization, [['id']]) : undefined)],
    ['workspace_id', firstString(claims, [['workspace_id']])],
  ];
  for (const [key, value] of values) {
    if (value && !tokens[key]) tokens[key] = value;
  }
}

function compatibleMetadata(value: unknown): CompatibleMetadata {
  if (!isObject(value)) return {};
  const note = firstString(value, [
    ['account_note'], ['accountInfo'], ['account_info'], ['note'], ['notes'], ['remark'],
  ]);
  const rawExpiresAt = firstValue(value, [
    ['expires'], ['expiresAt'], ['expires_at'], ['expired'], ['credentials', 'expires_at'],
  ]);
  return { note, expiresAt: normalizeExpiration(rawExpiresAt) };
}

function firstValue(value: JsonObject, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) {
      if (!isObject(current)) {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return undefined;
}

function normalizeExpiration(value: unknown) {
  if (value === undefined) return undefined;
  const parsedNumeric = typeof value === 'string' && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : Number.NaN;
  const numeric = typeof value === 'number' ? value : parsedNumeric;
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1e11 ? numeric : numeric * 1000)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function extractJsonSlices(content: string) {
  const slices: string[] = [];
  const stack: string[] = [];
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      if (stack.length) inString = true;
    } else if (character === '{' || character === '[') {
      if (!stack.length) start = index;
      stack.push(character);
    } else if (character === '}' || character === ']') {
      const open = stack.pop();
      if (!open || (character === '}' ? open !== '{' : open !== '[')) {
        stack.length = 0;
        start = -1;
      } else if (!stack.length && start >= 0) {
        slices.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return slices;
}

function firstString(value: JsonObject, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) {
      if (!isObject(current)) {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return undefined;
}

function isDecodableJwt(value: string) {
  const payload = value.split('.')[1];
  if (!payload) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    return isObject(decoded);
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class OfficialAccountImportService {
  private readonly clientId: string;
  private readonly issuer: string;

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) config: ConfigModuleOptions,
    private readonly admin: AdminService,
  ) {
    this.clientId = config.CODEX_OAUTH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
    this.issuer = (config.CODEX_OAUTH_ISSUER?.trim() || DEFAULT_ISSUER).replace(/\/+$/, '');
  }

  async import(actor: AuthUser, dto: ImportSystemAccountsDto) {
    const values = parseCompatibleJsonAccounts(dto.content);
    const accounts = [];
    const skipped: string[] = [];
    for (const [index, value] of values.entries()) {
      try {
        let auth = normalizeCompatibleAuth(value);
        if (!this.token(auth, 'access_token')) auth = await this.refresh(auth);
        const metadata = compatibleMetadata(value);
        accounts.push(await this.admin.createSystemAccount(actor, {
          auth,
          note: dto.note ?? metadata.note,
          expiresAt: dto.expiresAt ?? metadata.expiresAt,
        }));
      } catch (error) {
        const detail = error instanceof HttpException ? error.message : 'Unable to import account';
        skipped.push(`Account ${index + 1}: ${detail}`);
      }
    }
    if (!accounts.length) {
      throw new BadRequestException(skipped[0] ?? 'No accounts could be imported');
    }
    return { accounts, importedCount: accounts.length, skippedCount: skipped.length, skipped };
  }

  async importSub2api(actor: AuthUser, dto: ImportSystemAccountsDto) {
    const values = parseSub2apiJsonAccounts(dto.content);
    const accounts = [];
    const skipped: string[] = [];
    for (const [index, value] of values.entries()) {
      try {
        const auth = normalizeSub2apiAuth(value);
        const metadata = compatibleMetadata(value);
        accounts.push(await this.admin.createSystemAccount(actor, {
          auth,
          note: dto.note ?? metadata.note,
          expiresAt: dto.expiresAt ?? metadata.expiresAt,
        }));
      } catch (error) {
        const detail = error instanceof HttpException ? error.message : 'Unable to import account';
        skipped.push(`Account ${index + 1}: ${detail}`);
      }
    }
    if (!accounts.length) {
      throw new BadRequestException(skipped[0] ?? 'No accounts could be imported');
    }
    return { accounts, importedCount: accounts.length, skippedCount: skipped.length, skipped };
  }

  private async refresh(auth: JsonObject) {
    const refreshToken = this.token(auth, 'refresh_token');
    if (!refreshToken) {
      throw new BadRequestException('The imported account does not contain an access token or refresh token');
    }
    let response: Response;
    try {
      response = await fetch(`${this.issuer}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          originator: ORIGINATOR,
          'User-Agent': 'codex_cli_rs/0.1.0',
        },
        body: JSON.stringify({
          client_id: this.clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new BadGatewayException('Unable to reach the Codex OAuth service to refresh credentials');
    }
    if (!response.ok) {
      throw new BadGatewayException(`Unable to refresh imported credentials (HTTP ${response.status})`);
    }
    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      throw new BadGatewayException('Codex OAuth refresh response is not valid JSON');
    }
    if (!isObject(payload)) {
      throw new BadGatewayException('Codex OAuth refresh response is invalid');
    }
    const tokens = isObject(auth.tokens) ? { ...auth.tokens } : {};
    for (const key of ['id_token', 'access_token', 'refresh_token'] as const) {
      if (typeof payload[key] === 'string' && payload[key].trim()) tokens[key] = payload[key].trim();
    }
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
      throw new BadGatewayException('Codex OAuth refresh response is missing access_token');
    }
    return { tokens };
  }

  private token(auth: JsonObject, key: string) {
    if (!isObject(auth.tokens)) return undefined;
    const value = auth.tokens[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
