import {
  IsBoolean,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateAnnouncementDto {
  @IsString()
  @MaxLength(1000)
  contentZh: string;

  @IsString()
  @MaxLength(1000)
  contentEn: string;

  @IsString()
  @MaxLength(2048)
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  link: string;

  @IsBoolean()
  enabled: boolean;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  textColor: string;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  backgroundColor: string;

  @IsInt()
  @Min(5)
  @Max(120)
  scrollDurationSeconds: number;
}
