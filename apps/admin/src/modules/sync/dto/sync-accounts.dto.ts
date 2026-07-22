import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

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
