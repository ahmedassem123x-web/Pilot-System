// Pilot System v3.1 — Sprint 3 (PB-25). File HTTP surface, staff-only.
// Metadata only (see files.service.ts header): no file bytes are
// stored or served by this test implementation, and no real bucket is
// claimed. Signed links are short-lived and HMAC-verified.
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { mapDomainError } from '../common/http-errors';
import { FilesService } from './files.service';

@UseGuards(JwtAuthGuard)
@Controller('api/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  uploadMetadata(
    @Body()
    body: {
      transactionId?: string | null;
      filename: string;
      mimeType?: string | null;
      sizeBytes?: number | null;
      uploadedBy: string;
    },
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.files.uploadMetadata({
        transactionId: body.transactionId ?? null,
        filename: body.filename,
        mimeType: body.mimeType ?? null,
        sizeBytes: body.sizeBytes ?? null,
        uploadedBy: body.uploadedBy,
      }),
    ) as unknown as Record<string, unknown>;
  }

  @Get(':id/meta')
  meta(@Param('id') id: string): Record<string, unknown> {
    return mapDomainError(() => this.files.displayMetadata(id));
  }

  @Get(':id/link')
  signedLink(
    @Param('id') id: string,
    @Query('ttl') ttl: string | undefined,
  ): Record<string, unknown> {
    return mapDomainError(() =>
      this.files.generateSignedLink(id, ttl ? Number(ttl) : 900),
    ) as unknown as Record<string, unknown>;
  }

  @Get(':id/download')
  download(
    @Param('id') id: string,
    @Query('sig') sig: string | undefined,
    @Query('exp') exp: string | undefined,
  ): Record<string, unknown> {
    const check = this.files.verifySignedLink(id, sig, exp);
    if (!check.valid) {
      throw new ForbiddenException(check.reason ?? 'Invalid signed link');
    }
    return {
      // Test transport: metadata only. Real bytes arrive with the
      // Sprint 5 object-storage implementation (see service header).
      note: 'Test transport: metadata only, no file bytes are served here.',
      meta: mapDomainError(() => this.files.displayMetadata(id)),
    };
  }
}
