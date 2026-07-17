import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import { getKongJwtSecret } from '@/config/auth-secrets';
import type { ConfigModuleOptions } from '@/config/config.types';
import { UserService } from '@/modules/user/user.service';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { RbacService } from '@/modules/rbac/rbac.service';

interface AccessPayload {
  sub: string;
  email: string;
  role: string;
  iss: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) config: ConfigModuleOptions,
    private readonly userService: UserService,
    private readonly rbac: RbacService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getKongJwtSecret(config),
    });
  }

  async validate(payload: AccessPayload): Promise<AuthUser> {
    const user = await this.userService.findActiveById(payload.sub);
    if (!user) throw new UnauthorizedException('User is disabled or no longer exists');
    const access = await this.rbac.accessForRole(user.role);
    if (!access) throw new UnauthorizedException('User role is no longer available');
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      roleName: access.roleName,
      permissions: access.permissions,
    };
  }
}
