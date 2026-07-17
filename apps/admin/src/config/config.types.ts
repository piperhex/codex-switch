export interface ConfigModuleOptions {
  NODE_ENV?: string;
  LISTEN_PORT?: string;
  POSTGRES_HOST?: string;
  POSTGRES_PORT?: string;
  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
  POSTGRES_DB?: string;
  POSTGRES_DB_SYNCHRONIZE?: string;
  REDIS_HOST?: string;
  REDIS_PORT?: string;
  REDIS_PASSWORD?: string;
  JWT_ACCESS_EXPIRES?: string;
  JWT_REFRESH_SECRET?: string;
  REFRESH_TOKEN_TTL_SECONDS?: string;
  KONG_JWT_KEY?: string;
  KONG_JWT_SECRET?: string;
  CODEX_OAUTH_CLIENT_ID?: string;
  CODEX_OAUTH_ISSUER?: string;
  mail__transport?: string;
  mail__options__host?: string;
  mail__options__port?: string;
  mail__options__secure?: string;
  mail__options__auth__user?: string;
  mail__options__auth__pass?: string;
  mail__from?: string;
}

export interface ConfigModuleRegister extends ConfigModuleOptions {
  path?: string;
}
