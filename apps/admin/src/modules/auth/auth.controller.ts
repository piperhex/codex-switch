import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestPasswordResetCodeDto } from './dto/request-password-reset-code.dto';
import { RequestRegistrationCodeDto } from './dto/request-registration-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.verificationCode, dto.inviteToken);
  }

  @Post('register/code')
  requestRegistrationCode(@Body() dto: RequestRegistrationCodeDto) {
    return this.auth.requestRegistrationCode(dto.email);
  }

  @Post('password-reset/code')
  requestPasswordResetCode(@Body() dto: RequestPasswordResetCodeDto) {
    return this.auth.requestPasswordResetCode(dto.email);
  }

  @Post('password-reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.email, dto.verificationCode, dto.newPassword);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
