import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { PromptPluginsController } from './prompt-plugins.controller';
import { PromptPluginItemEntity } from './entities/prompt-plugin-item.entity';
import { PromptPluginsService } from './prompt-plugins.service';

@Module({
  imports: [JwtConfigModule, TypeOrmModule.forFeature([PromptPluginItemEntity])],
  controllers: [PromptPluginsController],
  providers: [PromptPluginsService],
})
export class PromptPluginsModule {}
