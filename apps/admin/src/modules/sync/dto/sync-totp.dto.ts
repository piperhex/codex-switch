import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TotpEntryDto {
  @IsUUID()
  id: string;

  @IsString()
  @MaxLength(160)
  issuer: string;

  @IsString()
  @MaxLength(320)
  accountName: string;

  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Z2-7]+$/)
  secret: string;

  @IsIn(['SHA1', 'SHA256', 'SHA512'])
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';

  @IsIn([6, 8])
  digits: 6 | 8;

  @IsInt()
  @Min(15)
  @Max(120)
  period: number;

  @IsISO8601({ strict: true })
  createdAt: string;
}

export class PutSyncTotpVaultDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TotpEntryDto)
  entries: TotpEntryDto[];

  @IsISO8601({ strict: true })
  modifiedAt: string;
}
