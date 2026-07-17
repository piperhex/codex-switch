import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateAnnouncementDto {
  @IsString()
  @MaxLength(1000)
  content: string;

  @IsBoolean()
  enabled: boolean;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  textColor: string;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  backgroundColor: string;
}
