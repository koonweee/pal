import {
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import busboy from 'busboy';
import { create as contentDisposition } from 'content-disposition';
import { ApplicationError } from '../../application/contracts/errors.js';
import { FilesService } from '../../files/files.service.js';
import { MAX_FILE_BYTES } from '../../files/application-file-storage.js';
import {
  ApplicationErrorResponseDto,
  AttachmentResponseDto,
} from './public.dto.js';

const INLINE_IMAGES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

@Injectable()
export class MultipartUploadAdapter {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  /** Converts first-party multipart framing into Pal's stream-based file port. */
  async upload(request: Request) {
    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: request.headers,
        defParamCharset: 'utf8',
        limits: { fileSize: MAX_FILE_BYTES + 1, files: 1, fields: 0, parts: 2 },
      });
    } catch {
      throw new ApplicationError(
        'invalid_input',
        'Expected multipart/form-data',
      );
    }

    let count = 0;
    let failure: Error | undefined;
    let staged: ReturnType<FilesService['prepareUpload']> | undefined;
    const abort = () =>
      parser.destroy(
        new ApplicationError('invalid_input', 'Upload interrupted'),
      );
    request.once('aborted', abort);
    request.once('error', abort);
    try {
      await new Promise<void>((resolve, reject) => {
        parser.once('error', reject);
        parser.once('close', resolve);
        parser.on('field', () => {
          failure ??= new ApplicationError(
            'invalid_input',
            'Only one file field is allowed',
          );
        });
        for (const event of [
          'filesLimit',
          'fieldsLimit',
          'partsLimit',
        ] as const)
          parser.on(event, () => {
            failure ??= new ApplicationError(
              'invalid_input',
              'Only one file field is allowed',
            );
          });
        parser.on('file', (field, stream, info) => {
          count++;
          if (field !== 'file') {
            failure ??= new ApplicationError(
              'invalid_input',
              'Expected a file field named file',
            );
            stream.resume();
            return;
          }
          staged = this.files.prepareUpload({
            stream,
            filename: info.filename,
            contentType: info.mimeType,
          });
        });
        request.pipe(parser);
      });
      if (failure) throw failure;
      if (count !== 1 || !staged)
        throw new ApplicationError(
          'invalid_input',
          'Exactly one file is required',
        );
      const prepared = await staged;
      if (failure) {
        await prepared.discard();
        throw failure;
      }
      return await prepared.commit();
    } catch (error) {
      if (staged) await (await staged).discard();
      throw error;
    } finally {
      request.off('aborted', abort);
      request.off('error', abort);
    }
  }
}

@ApiTags('files')
@ApiDefaultResponse({ type: ApplicationErrorResponseDto })
@ApiExtraModels(AttachmentResponseDto)
@Controller('files')
export class FirstPartyFilesController {
  constructor(
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(MultipartUploadAdapter)
    private readonly multipart: MultipartUploadAdapter,
  ) {}

  @Post()
  @ApiOperation({ operationId: 'uploadFile' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['attachment'],
      properties: {
        attachment: { $ref: '#/components/schemas/AttachmentResponseDto' },
      },
    },
  })
  async upload(@Req() request: Request) {
    return { attachment: await this.multipart.upload(request) };
  }

  @Get(':id/content')
  @ApiOperation({ operationId: 'getFileContent' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  content(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.send(id, response, false);
  }

  @Get(':id/download')
  @ApiOperation({ operationId: 'downloadFile' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.send(id, response, true);
  }

  private async send(id: string, response: Response, download: boolean) {
    const { file, handle } = await this.files.content(id);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=86400');
    const inline = !download && INLINE_IMAGES.has(file.contentType);
    return new StreamableFile(handle.createReadStream(), {
      type: inline ? file.contentType : 'application/octet-stream',
      length: file.sizeBytes,
      disposition: contentDisposition(file.filename, {
        type: inline ? 'inline' : 'attachment',
      }),
    });
  }
}
