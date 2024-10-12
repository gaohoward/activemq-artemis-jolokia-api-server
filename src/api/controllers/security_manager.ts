import fs from 'fs';
import yaml from 'js-yaml';
import * as bcrypt from 'bcryptjs';
import {
  AuthType,
  GenerateJWTToken,
  GetSecretToken,
  Permissions,
  PermissionType,
  Role,
  RoleList,
  User,
  UserList,
} from '../../utils/security_util';
import passport from 'passport';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { Request, Response } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';

const getAuthType = (): AuthType => {
  if (!process.env.API_SERVER_SECURITY_AUTH_TYPE) {
    return AuthType.Jwt;
  }
  if (process.env.API_SERVER_SECURITY_AUTH_TYPE === 'jwt') {
    return AuthType.Jwt;
  }
  return AuthType.Unknown;
};

export interface SecurityManager {
  start(): Promise<void>;
  getSecurityStore(): SecurityStore;
  checkPermissions(user: User, type: PermissionType, data?: any): Promise<void>;
  login(credential: any): Promise<string>;
  logOut(user: User): Promise<void>;
  validateRequest(
    req: Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>,
    res: Response<any, Record<string, any>>,
    next: any,
  ): void;
}

interface SecurityStore {
  isSuperUser(user: User): boolean;
  getAllUsers(): Map<string, User>;
  getAllRoles(): Map<string, Role>;
  start(): Promise<void>;
  checkPermissionOnEndpoint(user: User, targetEndpoint: string): void;
  checkPermissionOnAdmin(user: User): void;
  findUser(userName: any): Promise<User>;
  authenticate(userName: string, password: string): User | null;
}

class LocalSecurityStore implements SecurityStore {
  // userName => User
  usersMap: Map<string, User>;
  // roleName => Role
  rolesMap: Map<string, Role>;
  // Premissions
  permissions: Permissions;
  // user -> allowed endpoints
  userAccessTable = new Map<string, Set<string>>();
  // user -> roles
  userRolesTable = new Map<string, Set<string>>();

  superUser: string;

  isSuperUser(user: User): boolean {
    if (this.superUser) {
      return this.superUser === user.id;
    }
    return false;
  }

  getAllUsers(): Map<string, User> {
    return this.usersMap;
  }

  getAllRoles(): Map<string, Role> {
    return this.rolesMap;
  }

  start = async () => {
    this.usersMap = LocalSecurityStore.loadUsers(
      process.env.USERS_FILE_URL ? process.env.USERS_FILE_URL : '.users.json',
    );
    if (process.env.API_SERVER_ADMIN_USER) {
      this.superUser = process.env.API_SERVER_ADMIN_USER;
    } else {
      this.superUser = undefined;
    }
    this.rolesMap = LocalSecurityStore.loadRoles(
      process.env.USERS_FILE_URL ? process.env.ROLES_FILE_URL : '.roles.json',
    );
    this.permissions = LocalSecurityStore.loadPermissions(
      process.env.USERS_FILE_URL
        ? process.env.ACCESS_CONTROL_FILE_URL
        : '.access.json',
    );

    this.buildUserRoleAccessTable();
  };

  buildUserRoleAccessTable = () => {
    // first build role -> allowed endpoints
    const roleAccessTable = new Map<string, Set<string>>();

    this.permissions.endpoints?.forEach((ep) => {
      ep.roles.forEach((r) => {
        if (roleAccessTable.has(r)) {
          roleAccessTable.get(r).add(ep.name);
        } else {
          const endpointSet = new Set<string>();
          endpointSet.add(ep.name);
          roleAccessTable.set(r, endpointSet);
        }
      });
    });

    this.rolesMap.forEach((role) => {
      role.uids.forEach((uname) => {
        let userEndpoints = this.userAccessTable.get(uname);
        let userRoles = this.userRolesTable.get(uname);
        if (!userEndpoints) {
          userEndpoints = new Set<string>();
          this.userAccessTable.set(uname, userEndpoints);
        }

        roleAccessTable.get(role.name).forEach((endpoint) => {
          userEndpoints.add(endpoint);
        });
        if (!userRoles) {
          userRoles = new Set<string>();
          this.userRolesTable.set(uname, userRoles);
        }
        userRoles.add(role.name);
      });
    });
  };

  checkPermissionOnEndpoint(user: User, targetEndpoint: string): void {
    if (!targetEndpoint) {
      throw Error('no target endpoint specified');
    }
    const endpoints = this.userAccessTable.get(user.id);
    if (endpoints) {
      if (!endpoints.has(targetEndpoint)) {
        throw Error('no permission');
      }
    } else {
      throw Error('no permission');
    }
  }

  checkPermissionOnAdmin(user: User): void {
    const roles = this.userRolesTable.get(user.id);
    const isAdmin = this.permissions.admin.roles.some((r) => {
      if (roles.has(r)) {
        return true;
      }
    });
    if (!isAdmin) {
      throw Error('no permission');
    }
  }

  static loadUsers = (fileUrl: string): Map<string, User> => {
    const usersMap = new Map<string, User>();
    if (fs.existsSync(fileUrl)) {
      const fileContents = fs.readFileSync(fileUrl, 'utf8');
      const data = yaml.load(fileContents) as UserList;
      data?.users?.forEach((user) => {
        usersMap.set(user.id, user);
      });
    }
    return usersMap;
  };

  static loadRoles = (fileUrl: string): Map<string, Role> => {
    const rolesMap = new Map<string, Role>();
    if (fs.existsSync(fileUrl)) {
      const fileContents = fs.readFileSync(fileUrl, 'utf8');
      const data = yaml.load(fileContents) as RoleList;
      data?.roles?.forEach((role) => {
        rolesMap.set(role.name, role);
      });
    }
    return rolesMap;
  };

  static loadPermissions = (fileUrl: string): Permissions => {
    if (fs.existsSync(fileUrl)) {
      const fileContents = fs.readFileSync(fileUrl, 'utf8');
      const permissions = yaml.load(fileContents) as Permissions;
      if (permissions) {
        return permissions;
      }
    }
    return { endpoints: [], admin: { roles: [] } };
  };

  findUser = async (userName: string): Promise<User> => {
    if (this.usersMap.has(userName)) {
      return this.usersMap.get(userName);
    }
    throw Error(`No such user ${userName}`);
  };

  authenticate = (userName: string, password: string): User | null => {
    let authUser = null;

    if (this.usersMap.has(userName)) {
      const user = this.usersMap.get(userName);
      if (bcrypt.compareSync(password, user.hash)) {
        authUser = user;
      }
    }
    return authUser;
  };
}

class JwtSecurityManager implements SecurityManager {
  readonly securityStore: SecurityStore = new LocalSecurityStore();
  readonly authenticatedUsers: Set<string> = new Set();

  getSecurityStore(): SecurityStore {
    return this.securityStore;
  }

  logOut = async (user: User) => {
    this.authenticatedUsers.delete(user.id);
  };

  addActiveUser = (activeUser: User) => {
    this.authenticatedUsers.add(activeUser.id);
  };

  login = async (credential: any): Promise<string> => {
    const { userName, password } = credential;
    const user = this.securityStore.authenticate(userName, password);
    if (user) {
      const token = GenerateJWTToken(userName);
      this.addActiveUser(user);
      return token;
    }
    throw Error('wrong credentials');
  };

  validateRequest = (
    req: Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>,
    res: Response<any, Record<string, any>>,
    next: any,
  ): void => {
    passport.authenticate(AuthType.Jwt, { session: false })(req, res, next);
  };

  checkPermissions = async (
    user: User,
    type: PermissionType,
    data?: any,
  ): Promise<void> => {
    if (!this.securityStore.isSuperUser(user)) {
      switch (type) {
        case PermissionType.Endpoints: {
          this.securityStore.checkPermissionOnEndpoint(user, data);
          break;
        }
        case PermissionType.Admin: {
          this.securityStore.checkPermissionOnAdmin(user);
          break;
        }
        default:
          throw Error('invalid type ' + type);
      }
    }
  };

  start = async () => {
    this.securityStore.start().then(() => {
      const opts = {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: GetSecretToken(),
        ignoreExpiration: false,
      };

      passport.use(
        new JwtStrategy(opts, (jwt_payload, done) => {
          const userName = jwt_payload.id;
          if (userName) {
            //find the user
            const user = this.securityStore.findUser(userName).then((user) => {
              if (user) {
                return done(null, user);
              } else {
                return done(null, false);
              }
            });
          } else {
            return done(null, false);
          }
        }),
      );
    });
  };
}

let securityManager: SecurityManager;

export const InitSecurity = async () => {
  if (IsSecurityEnabled()) {
    const securityManager = GetSecurityManager();
    await securityManager.start();
  }
};

export const GetSecurityManager = (): SecurityManager => {
  if (!securityManager) {
    const authType = getAuthType();
    if (authType === AuthType.Jwt) {
      securityManager = new JwtSecurityManager();
    } else {
      throw Error('Auth type not supported ' + authType);
    }
  }
  return securityManager;
};

export const IsSecurityEnabled = (): boolean => {
  return process.env.API_SERVER_SECURITY_ENABLED !== 'false';
};
