import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { DeviceControlService } from './device-control.service';
import { DeviceGateway } from './device.gateway';
import { SwitchDeviceAccountDto } from './dto/switch-device-account.dto';

@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DeviceController {
  constructor(
    private readonly devices: DeviceControlService,
    private readonly gateway: DeviceGateway,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const devices = await this.devices.list(user.id);
    return {
      devices: devices.map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        platform: device.platform,
        appVersion: device.appVersion,
        activeAccountId: device.activeAccountId,
        lastSeenAt: device.lastSeenAt,
        online: this.gateway.isOnline(user.id, device.deviceId),
      })),
    };
  }

  @Post(':deviceId/account')
  async switchAccount(
    @CurrentUser() user: AuthUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: SwitchDeviceAccountDto,
  ) {
    await this.devices.getOwned(user.id, deviceId);
    await this.devices.assertAccountAvailable(user.id, dto.accountId);
    try {
      await this.gateway.pushAccountSwitch(user.id, deviceId, dto.accountId);
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : 'Account switch failed');
    }
    const device = await this.devices.setActiveAccount(user.id, deviceId, dto.accountId);
    return {
      deviceId: device.deviceId,
      activeAccountId: device.activeAccountId,
      online: true,
    };
  }
}
