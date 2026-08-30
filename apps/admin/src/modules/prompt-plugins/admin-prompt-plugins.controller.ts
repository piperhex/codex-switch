import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import {
  ListAdminPromptPluginsQueryDto,
  UpdateAdminPromptPluginDto,
} from './dto/admin-prompt-plugin.dto';
import { PromptPluginsService } from './prompt-plugins.service';

@Controller('admin/api/prompt-plugins')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.PromptPluginsRead)
export class AdminPromptPluginsController {
  constructor(private readonly plugins: PromptPluginsService) {}

  @Get()
  list(@Query() query: ListAdminPromptPluginsQueryDto) {
    return this.plugins.listForAdmin(query);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PromptPluginsManage)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAdminPromptPluginDto,
  ) {
    return this.plugins.updateForAdmin(actor, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.PromptPluginsManage)
  delete(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.plugins.deleteForAdmin(actor, id);
  }
}
