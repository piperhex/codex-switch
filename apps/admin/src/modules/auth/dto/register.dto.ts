import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'verificationCode must be a 6-digit number' })
  verificationCode: string;

  @IsOptional()
  @IsString()
  inviteToken?: string;
}
