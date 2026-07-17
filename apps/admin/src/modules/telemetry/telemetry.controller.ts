import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CreateInstallationEventDto } from './dto/create-installation-event.dto';
import { TelemetryService } from './telemetry.service';

@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Post('installations')
  @HttpCode(200)
  recordInstallation(@Body() dto: CreateInstallationEventDto) {
    return this.telemetry.recordInstallation(dto);
  }
}
