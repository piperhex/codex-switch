import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateEmailTemplateDto {
  @IsString()
  @MaxLength(300)
  subject: string;

  @IsString()
  @MaxLength(10_000)
  body: string;

  @IsOptional()
  @IsUUID()
  mailServiceId?: string | null;
}
