import { Body, Controller, Get, Header, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { CurrencyService } from './currency.service';
import { UpdateCurrencySettingsDto } from './dto/currency.dto';

@Controller()
export class CurrencyController {
  constructor(private readonly currencies: CurrencyService) {}

  @Get('currency-rates')
  @Header('Cache-Control', 'no-store')
  getPublicRates() {
    return this.currencies.getPublicRates();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.CurrencyRead)
  @Get('admin/api/currency')
  getAdmin() {
    return this.currencies.getAdmin();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.CurrencyManage)
  @Patch('admin/api/currency')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCurrencySettingsDto) {
    return this.currencies.update(user, dto);
  }
}
