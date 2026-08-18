import { IsString, MaxLength } from 'class-validator';

export class SwitchDeviceProviderGroupDto {
  @IsString()
  @MaxLength(80)
  group: string;
}
