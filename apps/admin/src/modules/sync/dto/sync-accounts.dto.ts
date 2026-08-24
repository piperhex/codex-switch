import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class AccountPrivateDetailsDto {
  @IsString()
  @MaxLength(1024)
  password: string = '';

  @IsString()
  @MaxLength(64)
  phoneNumber: string = '';

  @IsString()
  @MaxLength(512)
  @Matches(/^$|^[A-Z2-7]+$/)
  totpSecret: string = '';
}

export class AccountFieldModifiedAtDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  auth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  usage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  active?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  autoSwitchPriority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  autoSwitchThreshold?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  privateDetails?: string;
}

export class SyncAccountDto {
  @IsString()
  @MaxLength(64)
  id: string;

  @IsString()
  @MaxLength(240)
  email: string;

  @IsString()
  note: string = '';

  @IsString()
  @MaxLength(40)
  expiresAt: string = '';

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AccountPrivateDetailsDto)
  privateDetails?: AccountPrivateDetailsDto;

  @IsString()
  @MaxLength(80)
  plan: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  accountId?: string | null;

  @IsBoolean()
  active: boolean;

  @IsOptional()
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  autoSwitchPriority?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  autoSwitchThreshold?: number;

  @IsObject()
  usage: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  lastModifiedAt?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AccountFieldModifiedAtDto)
  fieldModifiedAt?: AccountFieldModifiedAtDto;

  @IsObject()
  auth: Record<string, unknown>;
}

export class PutSyncAccountsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncAccountDto)
  accounts: SyncAccountDto[];
}

export class UpdateAccountDetailsDto {
  @IsString()
  note: string = '';

  @IsString()
  @MaxLength(40)
  expiresAt: string = '';

  @IsObject()
  @ValidateNested()
  @Type(() => AccountPrivateDetailsDto)
  privateDetails: AccountPrivateDetailsDto = new AccountPrivateDetailsDto();
}
