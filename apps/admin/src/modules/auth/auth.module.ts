import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '@/modules/admin/admin.module';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { UserModule } from '@/modules/user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { RbacModule } from '@/common/rbac/rbac.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshTokenEntity]),
    UserModule,
    JwtConfigModule,
    AdminModule,
    RbacModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailVerificationService],
  exports: [AuthService],
})
export class AuthModule {}
