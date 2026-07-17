import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule } from '@/config/config.module';
import { PostgresqlModule } from '@/database/postgresql.module';
import { AdminModule } from '@/modules/admin/admin.module';
import { AnnouncementModule } from '@/modules/announcement/announcement.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { RedisModule } from '@/modules/redis/redis.module';
import { SyncModule } from '@/modules/sync/sync.module';
import { TelemetryModule } from '@/modules/telemetry/telemetry.module';
import { FeedbackModule } from '@/modules/feedback/feedback.module';
import { UserModule } from '@/modules/user/user.module';

@Module({
  imports: [
    ConfigModule.register({
      path: join(process.cwd(), '.env'),
    }),
    PostgresqlModule,
    RedisModule,
    UserModule,
    JwtConfigModule,
    AuthModule,
    SyncModule,
    AdminModule,
    AnnouncementModule,
    TelemetryModule,
    FeedbackModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
    }),
  ],
})
export class AppModule {}
