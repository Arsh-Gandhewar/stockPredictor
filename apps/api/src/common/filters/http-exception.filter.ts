import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      const rawResponse = exception.getResponse();
      let errorName = 'HTTP_' + status;

      if (typeof rawResponse === 'string') {
        message = rawResponse;
      } else if (typeof rawResponse === 'object' && rawResponse !== null) {
        const obj = rawResponse as Record<string, any>;
        message = obj.message || message;
        code = obj.error || code;
        errorName = obj.error || errorName;
      }
      
      if (Array.isArray(message)) {
        message = message.join(', ');
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`Unhandled Exception: ${exception.message}`, exception.stack);
    }

    const requestId = request.requestId || (request.headers['x-request-id'] as string) || 'unknown';

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        statusCode: status,
        requestId,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    });
  }
}
