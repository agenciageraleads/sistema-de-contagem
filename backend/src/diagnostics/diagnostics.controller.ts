import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';

@Controller('diagnostics')
export class DiagnosticsController {
  private readonly logger = new Logger(DiagnosticsController.name);

  @Post('client-error')
  @HttpCode(HttpStatus.NO_CONTENT)
  reportClientError(@Body() body: Record<string, unknown>) {
    const payload = {
      name: body?.name,
      message: body?.message,
      digest: body?.digest,
      url: body?.url,
      userAgent: body?.userAgent,
      reportedAt: body?.reportedAt,
      stack: typeof body?.stack === 'string' ? body.stack.slice(0, 4000) : undefined,
    };

    this.logger.warn(`Client-side error: ${JSON.stringify(payload)}`);
  }
}
