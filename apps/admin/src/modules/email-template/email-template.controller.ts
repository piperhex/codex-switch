import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { EmailTemplateService } from './email-template.service';

@Controller('admin/api/email-templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmailTemplateController {
  constructor(private readonly emailTemplates: EmailTemplateService) {}

  @Get()
  @RequirePermissions(Permission.EmailTemplatesRead)
  list() {
    return this.emailTemplates.list();
  }

  @Get(':code')
  @RequirePermissions(Permission.EmailTemplatesRead)
  get(@Param('code') code: string) {
    return this.emailTemplates.get(code);
  }

  @Patch(':code')
  @RequirePermissions(Permission.EmailTemplatesManage)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return this.emailTemplates.update(actor, code, dto);
  }
}
