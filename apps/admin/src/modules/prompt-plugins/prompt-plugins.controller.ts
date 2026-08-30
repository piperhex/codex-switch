import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { CreatePromptPluginDto } from './dto/create-prompt-plugin.dto';
import { PromptPluginsService } from './prompt-plugins.service';

@Controller('prompt-plugins')
export class PromptPluginsController {
  constructor(private readonly plugins: PromptPluginsService) {}

  @Get()
  list() { return this.plugins.list(); }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePromptPluginDto) {
    return this.plugins.create(user, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreatePromptPluginDto) {
    return this.plugins.update(user, id, dto);
  }

  @Get(':id/install')
  install(@Param('id') id: string) { return this.plugins.install(id); }
}
