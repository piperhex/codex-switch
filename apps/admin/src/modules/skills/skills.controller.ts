import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { CreateSkillDto } from './dto/create-skill.dto';
import {
  MAX_SKILL_ARCHIVE_BYTES,
  SkillsService,
  type UploadedSkillFile,
} from './skills.service';
import { Body } from '@nestjs/common';

interface SkillUploads {
  archive?: UploadedSkillFile[];
  preview?: UploadedSkillFile[];
}

const skillUpload = FileFieldsInterceptor([
  { name: 'archive', maxCount: 1 },
  { name: 'preview', maxCount: 1 },
], {
  limits: {
    files: 2,
    fileSize: MAX_SKILL_ARCHIVE_BYTES,
  },
});

@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  list() {
    return this.skills.list();
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(skillUpload)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSkillDto,
    @UploadedFiles() files: SkillUploads = {},
  ) {
    return this.skills.create(user, dto, files.archive?.[0], files.preview?.[0]);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(skillUpload)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateSkillDto,
    @UploadedFiles() files: SkillUploads = {},
  ) {
    return this.skills.update(user, id, dto, files.archive?.[0], files.preview?.[0]);
  }

  @Get(':id/preview')
  async preview(@Param('id') id: string, @Res() response: Response) {
    const preview = await this.skills.getPreview(id);
    response.setHeader('Content-Type', preview.mimeType);
    response.setHeader('Content-Length', String(preview.size));
    response.setHeader('Cache-Control', 'public, max-age=86400');
    return response.send(preview.data);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() response: Response) {
    const archive = await this.skills.download(id);
    const safeName = archive.fileName.replaceAll(/[\r\n"]/g, '_');
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Length', String(archive.data.length));
    response.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    response.setHeader('X-Skill-SHA256', archive.sha256);
    response.setHeader('Cache-Control', 'private, no-store');
    return response.send(archive.data);
  }
}
