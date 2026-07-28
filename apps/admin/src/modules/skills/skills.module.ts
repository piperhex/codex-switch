import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { SkillMarketItemEntity } from './entities/skill-market-item.entity';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

@Module({
  imports: [
    JwtConfigModule,
    TypeOrmModule.forFeature([SkillMarketItemEntity]),
  ],
  controllers: [SkillsController],
  providers: [SkillsService],
})
export class SkillsModule {}
