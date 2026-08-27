import { McpError } from '../errors/mcp-errors.js';

export type UserRole = 'PUBLIC_READ' | 'AUTHENTICATED_READ' | 'PAPER_TRADING' | 'ADMIN';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  PUBLIC_READ: 0,
  AUTHENTICATED_READ: 1,
  PAPER_TRADING: 2,
  ADMIN: 3,
};

export interface AuthContext {
  userId: string;
  role: UserRole;
  apiKey?: string;
  requestId: string;
}

export class AuthService {
  /**
   * Evaluates whether the given context satisfies the required role.
   */
  static isAuthorized(context: AuthContext, requiredRole: UserRole): boolean {
    const userLevel = ROLE_HIERARCHY[context.role] ?? -1;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 999;
    return userLevel >= requiredLevel;
  }

  /**
   * Asserts authorization or throws McpError with code FORBIDDEN or UNAUTHORIZED.
   */
  static assertAuthorized(context: AuthContext, requiredRole: UserRole, operationName: string): void {
    if (!AuthService.isAuthorized(context, requiredRole)) {
      if (context.role === 'PUBLIC_READ' && requiredRole !== 'PUBLIC_READ') {
        throw new McpError(
          'UNAUTHORIZED',
          `Authentication required for ${operationName}. Caller must have role '${requiredRole}'.`,
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
   * Validates that an operation scoped to a specific userId matches the authenticated caller's userId.
   * Prevents IDOR (Insecure Direct Object References) and cross-user data leakage.
   */
  static assertUserScope(context: AuthContext, requestedUserId?: string): string {
    if (!requestedUserId || requestedUserId.trim() === '') {
      return context.userId;
    }

    // Admins can inspect any user; non-admins can only access their own user scope
    if (context.role !== 'ADMIN' && requestedUserId !== context.userId) {
      throw new McpError(
        'FORBIDDEN',
        `Cannot access portfolio or jobs for another user ('${requestedUserId}'). Operation restricted to authenticated user ('${context.userId}').`,
        { details: { authenticatedUser: context.userId, requestedUser: requestedUserId } }
      );
    }

    return requestedUserId;
  }
}
