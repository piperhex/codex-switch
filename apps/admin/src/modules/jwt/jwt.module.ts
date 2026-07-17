import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { UserModule } from '@/modules/user/user.module';
import { RbacModule } from '@/common/rbac/rbac.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), UserModule, RbacModule],
  providers: [JwtStrategy],
  exports: [JwtModule, PassportModule],
})
export class JwtConfigModule {}
