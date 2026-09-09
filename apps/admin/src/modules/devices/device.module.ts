import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { SyncModule } from '@/modules/sync/sync.module';
import { UserModule } from '@/modules/user/user.module';
import { DeviceControlService } from './device-control.service';
import { DeviceController } from './device.controller';
import { DeviceGateway } from './device.gateway';
import { RemoteDeviceEntity } from './entities/remote-device.entity';
import { ChatAuthService } from './chat/chat-auth.service';
import { ChatGateway } from './chat/chat.gateway';
import { ChatStunService } from './chat/stun.service';

@Module({
  imports: [
    JwtConfigModule,
    UserModule,
    SyncModule,
    TypeOrmModule.forFeature([RemoteDeviceEntity]),
  ],
  controllers: [DeviceController],
  providers: [DeviceControlService, DeviceGateway, ChatAuthService, ChatGateway, ChatStunService],
})
export class DeviceModule {}
