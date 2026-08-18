import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { DeviceControlService } from './device-control.service';
import { DeviceGateway } from './device.gateway';
import { SwitchDeviceAccountDto } from './dto/switch-device-account.dto';
import { SwitchDeviceProviderDto } from './dto/switch-device-provider.dto';
import { SwitchDeviceProviderGroupDto } from './dto/switch-device-provider-group.dto';

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
        openaiAuthAccountId: device.openaiAuthAccountId,
        activeProviderId: device.activeProviderId ?? null,
        activeProviderGroup: device.activeProviderGroup ?? null,
        localProxyRunning: device.localProxyRunning ?? false,
        capabilities: device.capabilities ?? [],
        lastSeenAt: device.lastSeenAt,
        online: this.gateway.isOnline(user.id, device.deviceId),
      })),
    };
  }

  @Get('providers')
  async listProviders(@CurrentUser() user: AuthUser) {
    return { providers: await this.devices.listProviderSummaries(user.id) };
  }

  @Delete(':deviceId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('deviceId') deviceId: string,
  ) {
    await this.devices.getOwned(user.id, deviceId);
    if (this.gateway.isOnline(user.id, deviceId)) {
      throw new ConflictException('Online devices cannot be removed');
    }
    await this.devices.removeOwned(user.id, deviceId);
    this.gateway.notifyDeviceRemoved(user.id, deviceId);
  }

  @Post(':deviceId/account')
  async switchAccount(
    @CurrentUser() user: AuthUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: SwitchDeviceAccountDto,
  ) {
    const currentDevice = await this.devices.getOwned(user.id, deviceId);
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
      activeProviderId: device.activeProviderId,
      activeProviderGroup: device.activeProviderGroup,
      requiresRestart: Boolean(currentDevice.activeProviderId || currentDevice.activeProviderGroup),
      online: true,
    };
  }

  @Post(':deviceId/provider')
  async switchProvider(
    @CurrentUser() user: AuthUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: SwitchDeviceProviderDto,
  ) {
    const currentDevice = await this.devices.getOwned(user.id, deviceId);
    if (!(currentDevice.capabilities?.includes('provider-switch') ?? false)) {
      throw new ConflictException('请先更新目标 PC 上的 Codex Switch');
    }
    if (!currentDevice.localProxyRunning) {
      throw new ConflictException('请先在目标 PC 上启动本地代理');
    }
    await this.devices.assertProviderAvailable(user.id, dto.providerId);
    try {
      await this.gateway.pushProviderSwitch(user.id, deviceId, dto.providerId);
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : 'Provider switch failed');
    }
    const device = await this.devices.setActiveProvider(user.id, deviceId, dto.providerId);
    return {
      deviceId: device.deviceId,
      activeAccountId: device.activeAccountId,
      activeProviderId: device.activeProviderId,
      activeProviderGroup: device.activeProviderGroup,
      requiresRestart: !currentDevice.activeProviderId
        && !currentDevice.activeProviderGroup
        && Boolean(currentDevice.activeAccountId),
      online: true,
    };
  }

  @Post(':deviceId/provider-group')
  async switchProviderGroup(
    @CurrentUser() user: AuthUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: SwitchDeviceProviderGroupDto,
  ) {
    const currentDevice = await this.devices.getOwned(user.id, deviceId);
    if (!(currentDevice.capabilities?.includes('provider-group-switch') ?? false)) {
      throw new ConflictException('请先更新目标 PC 上的 Codex Switch');
    }
    if (!currentDevice.localProxyRunning) {
      throw new ConflictException('请先在目标 PC 上启动本地代理');
    }
    const group = dto.group.trim();
    await this.devices.assertProviderGroupAvailable(user.id, group);
    try {
      await this.gateway.pushProviderGroupSwitch(user.id, deviceId, group);
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : 'Provider group switch failed');
    }
    const device = await this.devices.setActiveProviderGroup(user.id, deviceId, group);
    return {
      deviceId: device.deviceId,
      activeAccountId: device.activeAccountId,
      activeProviderId: device.activeProviderId,
      activeProviderGroup: device.activeProviderGroup,
      requiresRestart: !currentDevice.activeProviderId
        && !currentDevice.activeProviderGroup
        && Boolean(currentDevice.activeAccountId),
      online: true,
    };
  }

  @Post(':deviceId/restart-codex')
  async restartCodex(
    @CurrentUser() user: AuthUser,
    @Param('deviceId') deviceId: string,
  ) {
    const device = await this.devices.getOwned(user.id, deviceId);
    if (!(device.capabilities?.includes('restart-codex') ?? false)) {
      throw new ConflictException('请先更新目标 PC 上的 Codex Switch');
    }
    try {
      await this.gateway.pushCodexRestart(user.id, deviceId);
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : 'Codex restart failed');
    }
    return { deviceId, restarted: true, online: true };
  }

  @Post(':deviceId/openai-auth-account')
  async setOpenAiAuthAccount(
    @CurrentUser() user: AuthUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: SwitchDeviceAccountDto,
  ) {
    await this.devices.getOwned(user.id, deviceId);
    await this.devices.assertAccountAvailable(user.id, dto.accountId);
    try {
      await this.gateway.pushOpenAiAuthAccountSwitch(user.id, deviceId, dto.accountId);
    } catch (error) {
      throw new ConflictException(
        error instanceof Error ? error.message : 'OpenAI login account switch failed',
      );
    }
    const device = await this.devices.setOpenAiAuthAccount(
      user.id,
      deviceId,
      dto.accountId,
    );
    return {
      deviceId: device.deviceId,
      openaiAuthAccountId: device.openaiAuthAccountId,
      online: true,
    };
  }
}
