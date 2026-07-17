import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import {
  CreateFeedbackDto,
  ListFeedbackQueryDto,
  SendFeedbackEmailDto,
} from './dto/feedback.dto';
import {
  FEEDBACK_IMAGE_MIME_TYPES,
  FeedbackService,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGES,
  type UploadedFeedbackImage,
} from './feedback.service';

function imageFileFilter(
  _request: unknown,
  file: { mimetype: string },
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (FEEDBACK_IMAGE_MIME_TYPES.has(file.mimetype)) callback(null, true);
  else callback(new BadRequestException('Only JPEG, PNG and WebP images are supported'), false);
}

const feedbackUpload = FilesInterceptor('images', MAX_FEEDBACK_IMAGES, {
  limits: { fileSize: MAX_FEEDBACK_IMAGE_BYTES },
  fileFilter: imageFileFilter,
});

@Controller()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post('feedback')
  @UseInterceptors(feedbackUpload)
  submitPublic(
    @Body() dto: CreateFeedbackDto,
    @UploadedFiles() images: UploadedFeedbackImage[] = [],
  ) {
    return this.feedback.create(dto, images);
  }

  @Post('feedback/authenticated')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(feedbackUpload)
  submitAuthenticated(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFeedbackDto,
    @UploadedFiles() images: UploadedFeedbackImage[] = [],
  ) {
    return this.feedback.create(dto, images, user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.FeedbackRead)
  @Get('admin/api/feedback')
  list(@Query() query: ListFeedbackQueryDto) {
    return this.feedback.list(query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.FeedbackRead)
  @Get('admin/api/feedback/:id')
  get(@Param('id') id: string) {
    return this.feedback.get(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.FeedbackRead)
  @Get('admin/api/feedback/:id/attachments/:attachmentId')
  async getAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() response: Response,
  ) {
    const attachment = await this.feedback.getAttachment(id, attachmentId);
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Length', String(attachment.size));
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, max-age=300');
    return response.send(attachment.data);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.FeedbackManage)
  @Post('admin/api/feedback/:id/email')
  sendEmail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendFeedbackEmailDto,
  ) {
    return this.feedback.sendEmail(user, id, dto);
  }
}
