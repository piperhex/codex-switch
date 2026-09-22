import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatTrafficEntity } from './chat-traffic.entity';
import { ChatTrafficService } from './chat-traffic.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChatTrafficEntity])],
  providers: [ChatTrafficService],
  exports: [ChatTrafficService],
})
export class ChatTrafficModule {}
