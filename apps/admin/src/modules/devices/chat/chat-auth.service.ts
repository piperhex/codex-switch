import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import { getKongJwtSecret } from '@/config/auth-secrets';
import type { ConfigModuleOptions } from '@/config/config.types';
import { UserService } from '@/modules/user/user.service';
import { DeviceControlService } from '../device-control.service';
import { identifier, type ChatIdentity } from './protocol';

@Injectable()
export class ChatAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UserService,
    private readonly devices: DeviceControlService,
    @Inject(MODULE_OPTIONS_TOKEN) private readonly config: ConfigModuleOptions,
  ) {}

  async authenticate(message: Record<string, unknown>): Promise<ChatIdentity> {
    if (message.type !== 'authenticate' || typeof message.accessToken !== 'string'
      || message.accessToken.length > 8192
      || (message.role !== 'desktop' && message.role !== 'mobile')) throw new Error('Invalid authentication');
    const payload = await this.jwt.verifyAsync<{ sub: string; exp: number }>(message.accessToken, {
      secret: getKongJwtSecret(this.config),
    });
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) throw new Error('Expired token');
    const user = await this.users.findActiveById(payload.sub);
    if (!user) throw new Error('Unavailable user');
    const deviceId = identifier(message.deviceId);
    await this.devices.getOwned(user.id, deviceId);
    return { ownerId: user.id, deviceId, role: message.role, expiresAt: payload.exp * 1000 };
  }
}
