import { IsString, MaxLength } from 'class-validator';

export class SwitchDeviceProviderDto {
  @IsString()
  @MaxLength(64)
  providerId: string;
}
