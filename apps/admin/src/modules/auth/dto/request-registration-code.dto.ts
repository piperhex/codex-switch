import { IsEmail } from 'class-validator';

export class RequestRegistrationCodeDto {
  @IsEmail()
  email: string;
}
