import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { Permission } from '@/common/rbac/permissions';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardService } from './dashboard.service';

@Controller('admin/api/dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.DashboardRead)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview(@Query() query: DashboardQueryDto) {
    return this.dashboard.getOverview(query.days);
  }
}
