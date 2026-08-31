import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';

export interface VerifiedJwtPayload {
  sub?: string;
  userId?: string;
  role?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
}

/**
 * QuantX Cryptographic Authentication Guard — BUG 5 Hardened.
 *
 * Enforces:
 * 1. Cryptographic signature verification (RS256 with Clerk PEM or HS256 with JWT_SECRET).
 * 2. Absolute prohibition on raw base64 unverified decoding.
 * 3. Token expiration (exp) and not-before (nbf) enforcement.
 * 4. User impersonation prevention (x-user-id must match token sub).
 * 5. Strict rejection of 'default_user' fallback in production.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] || '';
    const userIdHeader = request.headers['x-user-id'] || '';
    const apiKeyHeader = request.headers['x-api-key'] || '';
    const configuredApiKey = process.env.QUANTX_API_KEY || process.env.API_KEY;

    // Service-to-Service API Key authentication (e.g. MCP server adapter with shared secret)
    if (apiKeyHeader && configuredApiKey && apiKeyHeader === configuredApiKey) {
      // Caller authenticated as service principal. Strict non-impersonation:
      // Arbitrary caller-controlled identity selection via headers is completely disallowed.
      if (userIdHeader && userIdHeader !== 'quantx_service') {
        this.logger.warn(`API_KEY_IMPERSONATION_BLOCKED: API key caller attempted to select x-user-id '${userIdHeader}'`);
        throw new ForbiddenException(
          'API_KEY_IMPERSONATION_BLOCKED: Service API key requests cannot select arbitrary user identity via headers'
        );
      }
      const targetUserId = 'quantx_service';
      request.userId = targetUserId;
      request.user = { id: targetUserId, sub: targetUserId, role: 'SERVICE' };
      request.userRole = 'SERVICE';
      return true;
    }

    // 1. Extract Bearer token
    if (!authHeader.startsWith('Bearer ')) {
      // Check if running in explicit isolated test mode
      if (process.env.NODE_ENV === 'test' && process.env.ALLOW_LOCAL_MOCK_AUTH === 'true') {
        if (userIdHeader) {
          const sanitized = String(userIdHeader).replace(/[^a-zA-Z0-9_-]/g, '').trim();
          request.userId = sanitized;
          request.user = { id: sanitized, sub: sanitized, role: 'USER' };
          return true;
        }
      }
      throw new UnauthorizedException('UNAUTHENTICATED: Bearer authentication token is required');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedException('UNAUTHENTICATED: Empty authorization bearer token');
    }

    // 2. Cryptographic Verification
    const payload = this.verifyToken(token);
    const authenticatedUserId = payload.sub || payload.userId;

    if (!authenticatedUserId || typeof authenticatedUserId !== 'string' || authenticatedUserId.trim() === '') {
      throw new UnauthorizedException('UNAUTHENTICATED: Token payload does not contain a valid user identifier (sub)');
    }

    // 3. User Impersonation & Header Spoofing Protection
    if (userIdHeader) {
      const declaredUserId = String(userIdHeader).replace(/[^a-zA-Z0-9_-]/g, '').trim();
      if (declaredUserId && declaredUserId !== authenticatedUserId && payload.role !== 'ADMIN') {
        this.logger.warn(`IDENTITY_MISMATCH: Caller declared x-user-id '${declaredUserId}' but token principal is '${authenticatedUserId}'`);
        throw new ForbiddenException(
          `IDENTITY_MISMATCH: Caller header identity '${declaredUserId}' does not match authenticated token principal '${authenticatedUserId}'`
        );
      }
    }

    // 4. Server-Side Role Authorization Contract
    // Tokens cannot elevate privileges without explicit server-side role whitelisting
    const adminList = (process.env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const isWhitelistedAdmin = adminList.includes(authenticatedUserId);
    const authorizedRole = isWhitelistedAdmin ? 'ADMIN' : 'USER';

    request.user = { ...payload, role: authorizedRole };
    request.userId = authenticatedUserId;
    request.userRole = authorizedRole;

    return true;
  }

  /**
   * Cryptographically verifies JWT token structure, signature, and standard claims.
   * Fails closed on any corruption, expiry, or signature mismatch.
   */
  public verifyToken(token: string): VerifiedJwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('UNAUTHENTICATED: Malformed JWT token format (expected 3 parts)');
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode header & payload safely
    let header: { alg?: string; typ?: string };
    let payload: VerifiedJwtPayload;

    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    } catch {
      throw new UnauthorizedException('UNAUTHENTICATED: Failed to parse JWT token components');
    }

    // Alg check
    const alg = header.alg;
    const allowedAlgorithms = ['HS256', 'RS256'];
    if (!alg || !allowedAlgorithms.includes(alg)) {
      throw new UnauthorizedException(`UNAUTHENTICATED: Unsupported or insecure JWT algorithm '${alg || 'none'}'`);
    }

    const signingInput = `${headerB64}.${payloadB64}`;

    // Verify signature
    const isSignatureValid = this.verifySignature(signingInput, signatureB64, alg);
    if (!isSignatureValid) {
      throw new UnauthorizedException('UNAUTHENTICATED: Cryptographic signature verification failed');
    }

    // Validate expiration (exp) - MANDATORY: reject any token without exp
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp === undefined || typeof payload.exp !== 'number' || payload.exp <= nowSec) {
      throw new UnauthorizedException('UNAUTHENTICATED: Authentication token is missing valid expiration (exp) or is expired');
    }

    // Validate issued-at (iat) - STRICTLY MANDATORY
    if (payload.iat === undefined || typeof payload.iat !== 'number') {
      throw new UnauthorizedException('UNAUTHENTICATED: Authentication token is missing mandatory issued-at (iat) claim');
    }
    if (payload.iat > nowSec + 60) {
      throw new UnauthorizedException('UNAUTHENTICATED: Token issued in the future (clock skew violation)');
    }
    if (payload.iat > payload.exp) {
      throw new UnauthorizedException('UNAUTHENTICATED: Token issued-at (iat) cannot be after expiration (exp)');
    }

    // Validate not-before (nbf)
    if (payload.nbf !== undefined) {
      if (typeof payload.nbf !== 'number' || payload.nbf > nowSec) {
        throw new UnauthorizedException('UNAUTHENTICATED: Authentication token not yet valid (nbf)');
      }
    }

    const isProd = process.env.NODE_ENV === 'production';

    // Validate issuer - MANDATORY in production
    const expectedIssuer = process.env.CLERK_JWT_ISSUER || process.env.JWT_ISSUER;
    if (isProd && !expectedIssuer) {
      throw new UnauthorizedException('UNAUTHENTICATED: Mandatory JWT issuer configuration missing in production');
    }
    if (expectedIssuer) {
      if (!payload.iss || payload.iss !== expectedIssuer) {
        throw new UnauthorizedException(`UNAUTHENTICATED: Invalid or missing token issuer '${payload.iss || 'none'}'`);
      }
    }

    // Validate audience - MANDATORY in production
    const expectedAudience = process.env.CLERK_JWT_AUDIENCE || process.env.JWT_AUDIENCE;
    if (isProd && !expectedAudience) {
      throw new UnauthorizedException('UNAUTHENTICATED: Mandatory JWT audience configuration missing in production');
    }
    if (expectedAudience) {
      if (!payload.aud || payload.aud !== expectedAudience) {
        throw new UnauthorizedException(`UNAUTHENTICATED: Invalid or missing token audience '${payload.aud || 'none'}'`);
      }
    }

    return payload;
  }

  private verifySignature(signingInput: string, signatureB64: string, alg: string): boolean {
    const signatureBuffer = Buffer.from(signatureB64, 'base64url');

    // Secret resolution: Clerk PEM public key or HMAC secret
    const clerkPublicKey = process.env.CLERK_PEM_PUBLIC_KEY;
    const isProd = process.env.NODE_ENV === 'production';
    // Strictly require JWT_SECRET for HS256. CLERK_SECRET_KEY is never an HS256 secret.
    const jwtSecret = process.env.JWT_SECRET;

    if (isProd && !clerkPublicKey && !jwtSecret) {
      throw new UnauthorizedException('UNAUTHENTICATED: Cryptographic secret not configured in production');
    }

    const effectiveSecret = jwtSecret || (isProd ? '' : 'quantx-dev-test-secret-key-do-not-use-in-prod');
    if (!effectiveSecret && !clerkPublicKey) {
      return false;
    }

    try {
      if (alg === 'RS256' && clerkPublicKey) {
        // RS256 RSA public key verification
        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(signingInput);
        return verifier.verify(clerkPublicKey, signatureBuffer);
      } else if (alg === 'HS256' && effectiveSecret) {
        // HMAC-SHA256 symmetric verification
        const hmac = crypto.createHmac('sha256', effectiveSecret);
        hmac.update(signingInput);
        const expectedSignature = hmac.digest();
        if (signatureBuffer.length !== expectedSignature.length) {
          return false;
        }
        return crypto.timingSafeEqual(signatureBuffer, expectedSignature);
      } else {
        return false;
      }
    } catch (err) {
      this.logger.error(`Signature verification threw exception: ${err}`);
      return false;
    }
  }
}
