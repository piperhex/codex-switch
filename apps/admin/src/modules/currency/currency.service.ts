import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { getKongJwtSecret } from '@/config/auth-secrets';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { CurrencyItemDto, UpdateCurrencySettingsDto } from './dto/currency.dto';
import { CurrencySettingsEntity, type CurrencySettingItem } from './entities/currency-settings.entity';

const SETTINGS_ID = 'current';
const CURRENCY_API_URL = 'https://api.currencyapi.com/v3/latest';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CURRENCY_API_TIMEOUT_MS = 10_000;

interface CurrencyApiResponse {
  data?: Record<string, { code?: string; value?: number }>;
}

export interface CurrencyRate {
  code: string;
  name: string;
  rate: number;
}

export interface CurrencySettingsResponse {
  hasApiKey: boolean;
  currencies: CurrencySettingItem[];
  updatedAt: string | null;
}

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private readonly encryptionKey: Buffer;
  private cachedRates: { expiresAt: number; rates: CurrencyRate[] } | null = null;

  constructor(
    @InjectRepository(CurrencySettingsEntity)
    private readonly settings: Repository<CurrencySettingsEntity>,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
    @Inject(MODULE_OPTIONS_TOKEN) config: ConfigModuleOptions,
  ) {
    this.encryptionKey = createHash('sha256')
      .update(`codex-switch:currency-api:${getKongJwtSecret(config)}`)
      .digest();
  }

  async getAdmin(): Promise<CurrencySettingsResponse> {
    const setting = await this.findSettings(true);
    return this.present(setting);
  }

  async update(actor: AuthUser, dto: UpdateCurrencySettingsDto): Promise<CurrencySettingsResponse> {
    const currencies = this.normalizeCurrencies(dto.currencies);
    const setting = await this.findSettings(true) ?? this.settings.create({ id: SETTINGS_ID, currencies });
    if (dto.clearApiKey) setting.encryptedApiKey = null;
    if (dto.apiKey !== undefined) setting.encryptedApiKey = this.encrypt(dto.apiKey.trim());
    setting.currencies = currencies;
    setting.updatedById = actor.id;
    setting.updatedByEmail = actor.email;
    const saved = await this.settings.save(setting);
    this.cachedRates = null;
    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'currency-settings.update',
      targetType: 'currency-settings',
      targetId: SETTINGS_ID,
      metadata: {
        currencyCodes: currencies.map((item) => item.code),
        apiKeyChanged: dto.apiKey !== undefined || dto.clearApiKey === true,
      },
    }));
    return this.present(saved);
  }

  async getPublicRates(): Promise<{ currencies: CurrencyRate[]; updatedAt: string | null }> {
    if (this.cachedRates && this.cachedRates.expiresAt > Date.now()) {
      return { currencies: this.cachedRates.rates, updatedAt: new Date().toISOString() };
    }
    const setting = await this.findSettings(true);
    if (!setting?.encryptedApiKey || !setting.currencies.length) {
      return { currencies: [], updatedAt: setting?.updatedAt?.toISOString() ?? null };
    }
    const rates = await this.fetchRates(this.decrypt(setting.encryptedApiKey), setting.currencies);
    this.cachedRates = { expiresAt: Date.now() + CACHE_TTL_MS, rates };
    return { currencies: rates, updatedAt: setting.updatedAt?.toISOString() ?? null };
  }

  private async fetchRates(apiKey: string, currencies: CurrencySettingItem[]): Promise<CurrencyRate[]> {
    const query = new URLSearchParams({
      base_currency: 'USD',
      currencies: currencies.map((item) => item.code).join(','),
    });
    let response: Response;
    try {
      response = await fetch(`${CURRENCY_API_URL}?${query}`, {
        headers: { apikey: apiKey },
        signal: AbortSignal.timeout(CURRENCY_API_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`CurrencyAPI request failed: ${error instanceof Error ? error.message : 'network error'}`);
      throw new ServiceUnavailableException('Currency rates are temporarily unavailable');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('Currency rates are temporarily unavailable');
    }
    const payload = await response.json() as CurrencyApiResponse;
    return currencies.flatMap((currency) => {
      const value = payload.data?.[currency.code]?.value;
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? [{ code: currency.code, name: currency.name, rate: value }]
        : [];
    });
  }

  private async findSettings(withKey: boolean) {
    return this.settings.findOne({
      where: { id: SETTINGS_ID },
      ...(withKey ? {
        select: ['id', 'encryptedApiKey', 'currencies', 'updatedById', 'updatedByEmail', 'updatedAt'],
      } : {}),
    });
  }

  private normalizeCurrencies(items: CurrencyItemDto[]): CurrencySettingItem[] {
    const seen = new Set<string>();
    return items.map((item) => {
      const code = item.code.trim().toUpperCase();
      const name = item.name.trim();
      if (!/^[A-Z]{3}$/.test(code) || !name) {
        throw new BadRequestException('Currency code and name are required');
      }
      if (code === 'USD' || seen.has(code)) {
        throw new BadRequestException('Currency codes must be unique and cannot be USD');
      }
      seen.add(code);
      return { code, name };
    });
  }

  private present(setting: CurrencySettingsEntity | null): CurrencySettingsResponse {
    return {
      hasApiKey: Boolean(setting?.encryptedApiKey),
      currencies: setting?.currencies ?? [],
      updatedAt: setting?.updatedAt?.toISOString() ?? null,
    };
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  private decrypt(value: string) {
    const [version, iv, tag, encrypted] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !encrypted) {
      throw new ServiceUnavailableException('Currency API key is invalid');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('Currency API key is invalid');
    }
  }
}
