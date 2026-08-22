import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { RequireAnyPermissions, RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import {
  PutSyncAccountsDto,
  SyncAccountDto,
  UpdateAccountDetailsDto,
} from './dto/sync-accounts.dto';
import { PutSyncProvidersDto, SyncProviderDto } from './dto/sync-providers.dto';
import { PutSyncTotpVaultDto } from './dto/sync-totp.dto';
import { CompleteAccountOAuthDto } from './dto/complete-account-oauth.dto';
import { ImportPersonalAccountsDto } from './dto/import-personal-accounts.dto';
import { PersonalAccountEmbeddedOAuthService } from './personal-account-embedded-oauth.service';
import { PersonalAccountImportService } from './personal-account-import.service';
import { PersonalAccountOAuthService } from './personal-account-oauth.service';
import { SyncService } from './sync.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly personalAccountOAuth: PersonalAccountOAuthService,
    private readonly personalAccountEmbeddedOAuth: PersonalAccountEmbeddedOAuthService,
    private readonly personalAccountImport: PersonalAccountImportService,
  ) {}

  @Get('accounts')
  @RequirePermissions(Permission.SelfAccountsRead)
  list(@CurrentUser() user: AuthUser, @Headers('x-device-id') deviceId?: string) {
    return this.sync.list(
      user.id,
      deviceId,
      user.permissions?.includes(Permission.OfficialAccountMetadataWrite) ?? false,
    );
  }

  /**
   * Mobile clients receive the account overview, account-linked private details,
   * and the short-lived Codex access token needed for direct usage/reset-card
   * requests. Never expose the refresh token, ID token, or the rest of the auth payload.
   */
  @Get('accounts/summary')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsRead)
  listSummary(@CurrentUser() user: AuthUser) {
    return this.sync.listSummary(
      user.id,
      user.permissions?.includes(Permission.OfficialAccountMetadataWrite) ?? false,
    );
  }

  @Get('accounts/web-summary')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsRead)
  listWebSummary(@CurrentUser() user: AuthUser) {
    return this.sync.listWebSummary(user.id);
  }

  @Post('accounts/oauth/start')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsWrite)
  startAccountOAuth(@CurrentUser() user: AuthUser) {
    return this.personalAccountOAuth.start(user);
  }

  @Post('accounts/oauth/embedded/start')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsWrite)
  startEmbeddedAccountOAuth(@CurrentUser() user: AuthUser) {
    return this.personalAccountEmbeddedOAuth.start(user);
  }

  @Post('accounts/oauth/embedded/:sessionId/complete')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsWrite)
  completeEmbeddedAccountOAuth(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CompleteAccountOAuthDto,
  ) {
    return this.personalAccountEmbeddedOAuth.complete(user, sessionId, dto);
  }

  @Post('accounts/oauth/embedded/:sessionId/poll')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsWrite)
  pollEmbeddedAccountOAuth(@CurrentUser() user: AuthUser, @Param('sessionId') sessionId: string) {
    return this.personalAccountEmbeddedOAuth.poll(user, sessionId);
  }

  @Post('accounts/oauth/:sessionId/poll')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsWrite)
  pollAccountOAuth(@CurrentUser() user: AuthUser, @Param('sessionId') sessionId: string) {
    return this.personalAccountOAuth.poll(user, sessionId);
  }

  @Post('accounts/import')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsWrite)
  importAccounts(@CurrentUser() user: AuthUser, @Body() dto: ImportPersonalAccountsDto) {
    return this.personalAccountImport.import(user, dto);
  }

  @Get('accounts/:id/details')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsRead)
  accountDetails(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.accountDetails(user.id, id);
  }
  @Patch('accounts/:id/details')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsWrite)
  updateAccountDetails(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDetailsDto,
  ) {
    return this.sync.updateAccountDetails(
      user.id,
      id,
      dto,
      user.permissions?.includes(Permission.OfficialAccountMetadataWrite) ?? false,
    );
  }

  @Get('accounts/:id/usage')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsRead)
  usage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.fetchUsage(user.id, id);
  }

  @Get('accounts/:id/reset-credits')
  @RequirePermissions(Permission.SelfAccountsRead)
  resetCredits(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.fetchResetCredits(user.id, id);
  }

  @Post('accounts/:id/reset-credits/consume')
  @RequirePermissions(Permission.SelfAccountsWrite)
  consumeResetCredit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.consumeResetCredit(user.id, id);
  }

  @Put('accounts')
  @RequireAnyPermissions(
    Permission.SelfAccountsWrite,
    Permission.OfficialAccountMetadataWrite,
  )
  replace(
    @CurrentUser() user: AuthUser,
    @Body() dto: PutSyncAccountsDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.sync.replace(
      user.id,
      dto,
      deviceId,
      user.permissions?.includes(Permission.OfficialAccountMetadataWrite) ?? false,
    );
  }

  @Put('accounts/:id')
  @RequireAnyPermissions(
    Permission.SelfAccountsWrite,
    Permission.OfficialAccountMetadataWrite,
  )
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SyncAccountDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.sync.upsert(
      user.id,
      id,
      dto,
      deviceId,
      user.permissions?.includes(Permission.OfficialAccountMetadataWrite) ?? false,
    );
  }

  @Delete('accounts/:id')
  @RequirePermissions(Permission.SelfAccountsWrite)
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.delete(user.id, id);
  }

  @Get('providers')
  @RequirePermissions(Permission.SelfProvidersRead)
  listProviders(@CurrentUser() user: AuthUser) {
    return this.sync.listProviders(user.id);
  }

  @Put('providers')
  @RequirePermissions(Permission.SelfProvidersWrite)
  replaceProviders(@CurrentUser() user: AuthUser, @Body() dto: PutSyncProvidersDto) {
    return this.sync.replaceProviders(user.id, dto);
  }

  @Put('providers/:id')
  @RequirePermissions(Permission.SelfProvidersWrite)
  upsertProvider(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SyncProviderDto,
  ) {
    return this.sync.upsertProvider(user.id, id, dto);
  }

  @Delete('providers/:id')
  @RequirePermissions(Permission.SelfProvidersWrite)
  deleteProvider(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.deleteProvider(user.id, id);
  }

  @Get('totp')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsRead)
  getTotpVault(@CurrentUser() user: AuthUser) {
    return this.sync.getTotpVault(user.id);
  }

  @Put('totp')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.SelfAccountsWrite)
  putTotpVault(@CurrentUser() user: AuthUser, @Body() dto: PutSyncTotpVaultDto) {
    return this.sync.putTotpVault(user.id, dto);
  }
}
