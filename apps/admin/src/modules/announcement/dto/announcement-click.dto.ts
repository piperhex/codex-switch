import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const announcementPlatforms = ['windows', 'macos', 'linux', 'android', 'ios'] as const;

export class CreateAnnouncementClickDto {
  @IsUUID('4')
  deviceId: string;

  @IsIn(announcementPlatforms)
  platform: typeof announcementPlatforms[number];

  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  link: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  announcementUpdatedAt?: string;
}

export class ListAnnouncementClicksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsIn(announcementPlatforms)
  platform?: typeof announcementPlatforms[number];
}
