import { IsIn, IsUUID } from 'class-validator';

export class CreateInstallationEventDto {
  @IsUUID('4')
  deviceId: string;

  @IsIn(['windows', 'macos', 'linux'])
  platform: 'windows' | 'macos' | 'linux';

  @IsIn(['installation', 'base_url_changed'])
  eventType: 'installation' | 'base_url_changed';
}
