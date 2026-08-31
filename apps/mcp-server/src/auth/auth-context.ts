import { McpError } from '../errors/mcp-errors.js';
import * as crypto from 'crypto';

export type UserRole = 'PUBLIC_READ' | 'AUTHENTICATED_READ' | 'SERVICE' | 'PAPER_TRADING' | 'ADMIN';

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  PUBLIC_READ: 0,
  AUTHENTICATED_READ: 1,
  SERVICE: 2,
  PAPER_TRADING: 2,
  ADMIN: 3,
};

export interface DecodedJwtPayload {
  sub?: string;
  userId?: string;
  role?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  scopes?: string[];
}

export interface AuthenticatedPrincipal {
  principalId: string;
  userId: string;
  role: UserRole;
  authenticatedAt: string;
  authMethod: 'BEARER_JWT' | 'API_KEY' | 'LOCAL_PROCESS_TRUST' | 'UNAUTHENTICATED';
  scopes: string[];
}

export interface AuthContext {
  principal: AuthenticatedPrincipal;
  userId: string;
  role: UserRole;
  apiKey?: string;
  requestId: string;
  timestamp: string;
}

export class AuthService {
  /**
   * Resolves authentication context from request metadata or headers.
   * NEVER defaults to ADMIN or default_user.
   */
  static resolvePrincipal(
    authHeader?: string,
    apiKeyHeader?: string,
    processConfig?: {
      localTrustMode?: boolean;
      localTrustUserId?: string;
      localTrustRole?: UserRole;
      apiKey?: string;
    },
    requestId?: string
  ): AuthContext {
    const reqId = requestId || `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    // 1. Bearer JWT Authentication
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token) {
        const verified = AuthService.verifyJwt(token);
        if (verified) {
          const role: UserRole = AuthService.sanitizeRole(verified.role || 'AUTHENTICATED_READ');
          const userId = verified.sub || verified.userId;
          if (!userId) {
            throw new McpError('UNAUTHORIZED', 'JWT token missing user subject (sub)');
          }
          return {
            principal: {
              principalId: `jwt:${userId}`,
              userId,
              role,
              authenticatedAt: nowIso,
              authMethod: 'BEARER_JWT',
              scopes: verified.scopes || [role],
            },
            userId,
            role,
            requestId: reqId,
            timestamp: nowIso,
          };
        }
      }
    }

    // 2. API Key Authentication (Service-to-Service)
    if (apiKeyHeader && processConfig?.apiKey && apiKeyHeader === processConfig.apiKey) {
      const serviceUserId = processConfig.localTrustUserId || 'quantx_mcp_service';
      const role: UserRole = processConfig.localTrustRole || 'PAPER_TRADING';
      return {
        principal: {
          principalId: `apikey:${serviceUserId}`,
          userId: serviceUserId,
          role,
          authenticatedAt: nowIso,
          authMethod: 'API_KEY',
          scopes: [role],
        },
        userId: serviceUserId,
        role,
        apiKey: apiKeyHeader,
        requestId: reqId,
        timestamp: nowIso,
      };
    }

    // 3. Explicit Local Process Trust Mode (STDIO single-user local binding)
    if (processConfig?.localTrustMode === true && processConfig.localTrustUserId) {
      const localRole: UserRole = processConfig.localTrustRole || 'AUTHENTICATED_READ';
      return {
        principal: {
          principalId: `local:${processConfig.localTrustUserId}`,
          userId: processConfig.localTrustUserId,
          role: localRole,
          authenticatedAt: nowIso,
          authMethod: 'LOCAL_PROCESS_TRUST',
          scopes: [localRole],
        },
        userId: processConfig.localTrustUserId,
        role: localRole,
        requestId: reqId,
        timestamp: nowIso,
      };
    }

    // 4. Default: Anonymous Unauthenticated (PUBLIC_READ only)
    return {
      principal: {
        principalId: 'anon:public',
        userId: 'anonymous',
        role: 'PUBLIC_READ',
        authenticatedAt: nowIso,
        authMethod: 'UNAUTHENTICATED',
        scopes: ['PUBLIC_READ'],
      },
      userId: 'anonymous',
      role: 'PUBLIC_READ',
      requestId: reqId,
      timestamp: nowIso,
    };
  }

  /**
   * Cryptographically verifies JWT token.
   */
  static verifyJwt(token: string): DecodedJwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new McpError('UNAUTHORIZED', 'Malformed JWT token format');
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    let header: { alg?: string; typ?: string };
    let payload: DecodedJwtPayload;

    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    } catch {
      throw new McpError('UNAUTHORIZED', 'Invalid JSON in JWT token');
    }

    // Strict algorithm allowlist
    const alg = header.alg;
    const allowedAlgorithms = ['HS256', 'RS256'];
    if (!alg || !allowedAlgorithms.includes(alg)) {
      throw new McpError('UNAUTHORIZED', `Unsupported or insecure JWT algorithm: ${alg || 'none'}`);
    }

    const isProd = process.env.NODE_ENV === 'production';
    const rawSecret = process.env.JWT_SECRET;
    const clerkPublicKey = process.env.CLERK_PEM_PUBLIC_KEY;

    if (isProd && !clerkPublicKey && !rawSecret) {
      throw new McpError('UNAUTHORIZED', 'Cryptographic secret not configured in production');
    }

    const jwtSecret = rawSecret || (isProd ? '' : 'quantx-dev-test-secret-key-do-not-use-in-prod');
    const signingInput = `${headerB64}.${payloadB64}`;
    const signatureBuffer = Buffer.from(signatureB64, 'base64url');

    let isValid = false;
    try {
      if (alg === 'RS256' && clerkPublicKey) {
        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(signingInput);
        isValid = verifier.verify(clerkPublicKey, signatureBuffer);
      } else if (alg === 'HS256' && jwtSecret) {
        const hmac = crypto.createHmac('sha256', jwtSecret);
        hmac.update(signingInput);
        const expected = hmac.digest();
        if (signatureBuffer.length === expected.length) {
          isValid = crypto.timingSafeEqual(signatureBuffer, expected);
        }
      }
    } catch {
      isValid = false;
    }

    if (!isValid) {
      throw new McpError('UNAUTHORIZED', 'Invalid cryptographic JWT signature');
    }

    // Expiry check - MANDATORY
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp === undefined || typeof payload.exp !== 'number' || payload.exp <= nowSec) {
      throw new McpError('UNAUTHORIZED', 'Authentication token is missing valid expiration (exp) or is expired');
    }

    // Issued-at check - STRICTLY MANDATORY
    if (payload.iat === undefined || typeof payload.iat !== 'number') {
      throw new McpError('UNAUTHORIZED', 'Authentication token is missing mandatory issued-at (iat) claim');
    }
    if (payload.iat > nowSec + 60) {
      throw new McpError('UNAUTHORIZED', 'Authentication token issued in the future (clock skew violation)');
    }
    if (payload.iat > payload.exp) {
      throw new McpError('UNAUTHORIZED', 'Authentication token issued-at (iat) cannot be after expiration (exp)');
    }

    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > nowSec)) {
      throw new McpError('UNAUTHORIZED', 'Authentication JWT token is not yet valid (nbf)');
    }

    // Validate issuer - MANDATORY in production
    const expectedIssuer = process.env.CLERK_JWT_ISSUER || process.env.JWT_ISSUER;
    if (isProd && !expectedIssuer) {
      throw new McpError('UNAUTHORIZED', 'Mandatory JWT issuer configuration missing in production');
    }
    if (expectedIssuer) {
      if (!payload.iss || payload.iss !== expectedIssuer) {
        throw new McpError('UNAUTHORIZED', `Invalid or missing token issuer '${payload.iss || 'none'}'`);
      }
    }

    // Validate audience - MANDATORY in production
    const expectedAudience = process.env.CLERK_JWT_AUDIENCE || process.env.JWT_AUDIENCE;
    if (isProd && !expectedAudience) {
      throw new McpError('UNAUTHORIZED', 'Mandatory JWT audience configuration missing in production');
    }
    if (expectedAudience) {
      if (!payload.aud || payload.aud !== expectedAudience) {
        throw new McpError('UNAUTHORIZED', `Invalid or missing token audience '${payload.aud || 'none'}'`);
      }
    }

    return payload;
  }

  static sanitizeRole(rawRole: string): UserRole {
    const r = String(rawRole).toUpperCase().trim();
    if (r === 'ADMIN') return 'ADMIN';
    if (r === 'PAPER_TRADING') return 'PAPER_TRADING';
    if (r === 'AUTHENTICATED_READ') return 'AUTHENTICATED_READ';
    return 'PUBLIC_READ';
  }

  static isAuthorized(context: AuthContext, requiredRole: UserRole): boolean {
    const userLevel = ROLE_HIERARCHY[context.role] ?? -1;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 999;
    return userLevel >= requiredLevel;
  }

  static assertAuthorized(context: AuthContext, requiredRole: UserRole, operationName: string): void {
    if (!AuthService.isAuthorized(context, requiredRole)) {
      if (context.role === 'PUBLIC_READ' && requiredRole !== 'PUBLIC_READ') {
        throw new McpError(
          'UNAUTHORIZED',
          `Authentication required for ${operationName}. Caller must authenticate with role '${requiredRole}'.`,
          { details: { operation: operationName, callerRole: context.role, requiredRole } }
        );
      }
      throw new McpError(
        'FORBIDDEN',
        `Forbidden: Caller with role '${context.role}' does not have permission '${requiredRole}' for ${operationName}.`,
        { details: { operation: operationName, callerRole: context.role, requiredRole } }
      );
    }
  }

  /**
   * Enforces user isolation (anti-IDOR).
   */
  static assertUserScope(context: AuthContext, requestedUserId?: string): string {
    if (!requestedUserId || requestedUserId.trim() === '') {
      return context.userId;
    }

    const cleanRequested = requestedUserId.trim();
    // Admins can inspect any user; non-admins are strictly confined to their own authenticated userId
    if (context.role !== 'ADMIN' && cleanRequested !== context.userId) {
      throw new McpError(
        'FORBIDDEN',
        `IDOR Violation: Authenticated user '${context.userId}' cannot access or mutate resources for user '${cleanRequested}'.`,
        { details: { authenticatedUser: context.userId, requestedUser: cleanRequested } }
      );
    }

    return cleanRequested;
  }
}
