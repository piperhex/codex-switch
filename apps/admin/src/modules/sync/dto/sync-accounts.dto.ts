import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
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
