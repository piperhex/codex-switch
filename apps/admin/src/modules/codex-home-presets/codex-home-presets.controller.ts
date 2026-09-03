import { Body, Controller, Get, Header, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { CodexHomePresetsService } from './codex-home-presets.service';
import {
  CodexHomePresetPlatformDto,
  UpdateCodexHomePresetsDto,
} from './dto/codex-home-presets.dto';

@Controller()
export class CodexHomePresetsController {
  constructor(private readonly presets: CodexHomePresetsService) {}

  @Get('codex-home-presets')
  @Header('Cache-Control', 'no-store')
  getPublic(@Query() query: CodexHomePresetPlatformDto) {
    return this.presets.getPublic(query.platform);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.CodexHomePresetsRead)
  @Get('admin/api/codex-home-presets')
  getAdmin() {
    return this.presets.getAdmin();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.CodexHomePresetsManage)
  @Patch('admin/api/codex-home-presets')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCodexHomePresetsDto) {
    return this.presets.update(user, dto.presets);
  }
}
