import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { AnnouncementService } from './announcement.service';
import {
  CreateAnnouncementClickDto,
  ListAnnouncementClicksQueryDto,
} from './dto/announcement-click.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Controller()
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get('announcements/current')
  @Header('Cache-Control', 'no-store')
  getCurrent() {
    return this.announcements.getPublic();
  }

  @Post('announcements/clicks')
  @HttpCode(200)
  recordPublicClick(@Body() dto: CreateAnnouncementClickDto) {
    return this.announcements.recordClick(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('announcements/clicks/authenticated')
  @HttpCode(200)
  recordAuthenticatedClick(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAnnouncementClickDto,
  ) {
    return this.announcements.recordClick(dto, user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AnnouncementsRead)
  @Get('admin/api/announcement')
  getAdminConfig() {
    return this.announcements.getAdmin();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AnnouncementsRead)
  @Get('admin/api/announcement/clicks/overview')
  getClickOverview() {
    return this.announcements.getClickOverview();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AnnouncementsRead)
  @Get('admin/api/announcement/clicks')
  listClicks(@Query() query: ListAnnouncementClicksQueryDto) {
    return this.announcements.listClicks(query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AnnouncementsManage)
  @Patch('admin/api/announcement')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcements.update(user, dto);
  }
}
