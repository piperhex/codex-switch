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
  ListAdminSkillsQueryDto,
  UpdateAdminSkillDto,
} from './dto/admin-skill.dto';
import { SkillsService } from './skills.service';

@Controller('admin/api/skills')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.SkillsRead)
export class AdminSkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  list(@Query() query: ListAdminSkillsQueryDto) {
    return this.skills.listForAdmin(query);
  }

  @Patch(':id')
  @RequirePermissions(Permission.SkillsManage)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAdminSkillDto,
  ) {
    return this.skills.updateForAdmin(actor, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.SkillsManage)
  delete(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.skills.deleteForAdmin(actor, id);
  }
}
