import { Module } from '@nestjs/common';
import { ChatTrafficModule } from '../chat-traffic/chat-traffic.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ChatTrafficModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
