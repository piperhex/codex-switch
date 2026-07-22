import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { CreateMailServiceDto, UpdateMailServiceDto } from './dto/mail-service.dto';
import { MailService } from './mail.service';

@Controller('admin/api/mail-services')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get()
  @RequirePermissions(Permission.MailServicesRead)
  list() {
    return this.mail.list();
  }

  @Post()
  @RequirePermissions(Permission.MailServicesManage)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateMailServiceDto) {
    return this.mail.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.MailServicesManage)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMailServiceDto,
  ) {
    return this.mail.update(actor, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.MailServicesManage)
  delete(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.mail.delete(actor, id);
  }
}
