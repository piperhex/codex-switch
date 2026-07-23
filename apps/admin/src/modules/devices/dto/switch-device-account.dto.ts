import { IsString, MaxLength } from 'class-validator';

export class SwitchDeviceAccountDto {
  @IsString()
  @MaxLength(64)
  accountId: string;
}
