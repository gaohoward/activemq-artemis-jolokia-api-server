import base64 from 'base-64';
import jwt from 'jsonwebtoken';
import { Headers } from 'node-fetch';
import https from 'https';
import fs from 'fs';
import http from 'http';
import { logger } from './logger';

export const GetSecretToken = (): string => {
  return process.env.SECRET_ACCESS_TOKEN as string;
};

export const GenerateJWTToken = (id: string): string => {
  const payload = {
    id: id,
  };
  return jwt.sign(payload, GetSecretToken(), {
    expiresIn: 60 * 60 * 1000,
  });
};

export enum AuthType {
  Jwt = 'jwt',
  Unknown = 'unknown',
}

export interface User {
  id: string;
  email?: string;
  hash: string;
}

export interface UserList {
  users: User[];
}

export interface Role {
  name: string;
  uids: string[];
}

export interface RoleList {
  roles: Role[];
}

export enum PermissionType {
  Endpoints = 'endpoints',
  Admin = 'admin',
}

export enum AuthScheme {
  //user name and password
  Basic = 'basic',
  //client cert in mtls
  Cert = 'cert',
}
export interface EndpointsPermission {
  name: string;
  roles: string[];
}

export interface AdminPermission {
  roles: string[];
}
export interface Permissions {
  endpoints: EndpointsPermission[];
  admin: AdminPermission;
}

export interface AuthenticationData {
  readonly scheme: AuthScheme;
  readonly data: any;
}

export interface BasicAuthData {
  readonly username: string;
  readonly password: string;
}

export interface CertAuthData {
  readonly certpath: string;
  readonly keypath: string;
}

export interface Endpoint {
  readonly name: string;
  readonly url: string;
  readonly jolokiaPrefix?: string;
  readonly auth: AuthenticationData[];
}

export interface EndpointList {
  endpoints: Endpoint[];
}

export interface AuthOptions {
  agent?: http.Agent;
  headers: Headers;
}

export abstract class AuthHandler {
  abstract handleRequest(reqUrl: string, authOpts: AuthOptions): void;
  isHttps = (url: string): boolean => {
    return url.startsWith('https://');
  };
}

class BasicAuthHandler extends AuthHandler {
  readonly basicAuth: BasicAuthData;

  constructor(cred: BasicAuthData) {
    super();
    this.basicAuth = cred;
  }

  handleRequest = (reqUrl: string, authOpts: AuthOptions): void => {
    if (this.isHttps(reqUrl)) {
      authOpts.agent = new https.Agent({
        // Disables certificate validation, can we use this instead of setting NODE_TLS_REJECT_UNAUTHORIZED='0'?
        rejectUnauthorized: false,
      });
    }
    authOpts.headers.set(
      'Authorization',
      'Basic ' +
        base64.encode(this.basicAuth.username + ':' + this.basicAuth.password),
    );
  };
}

class CertAuthHandler extends AuthHandler {
  readonly certAuth: CertAuthData;

  constructor(cred: CertAuthData) {
    super();
    this.validateFiles(cred);
    this.certAuth = cred;
  }

  validateFiles = (cred: CertAuthData) => {
    if (!fs.existsSync(cred.certpath)) {
      throw Error('cert file not exist');
    }
    if (!fs.existsSync(cred.keypath)) {
      throw Error('key file not exist');
    }
  };

  getCert = () => {
    return fs.readFileSync(this.certAuth.certpath);
  };

  getKey = () => {
    return fs.readFileSync(this.certAuth.keypath);
  };

  handleRequest = (reqUrl: string, authOpts: AuthOptions): void => {
    logger.warn(
      'The certificate authentication is experimental and may not work properly',
    );
    if (!this.isHttps(reqUrl)) {
      throw Error('auth only works with https');
    }
    authOpts.agent = new https.Agent({
      // Disables certificate validation, can we use this instead of setting NODE_TLS_REJECT_UNAUTHORIZED='0'?
      rejectUnauthorized: false,
      // ca: trusted ca bundle
      cert: this.getCert(),
      key: this.getKey(),
    });
  };
}

export const CreateAuthHandler = (data: AuthenticationData): AuthHandler => {
  switch (data.scheme) {
    case AuthScheme.Basic: {
      return new BasicAuthHandler(data.data);
    }
    case AuthScheme.Cert: {
      return new CertAuthHandler(data.data);
    }
    default: {
      throw Error('auth scheme not supported: ' + data.scheme);
    }
  }
};
