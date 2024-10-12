import jwt from 'jsonwebtoken';

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

export interface Endpoint {
  name: string;
  url: string;
  username: string;
  password: string;
}

export interface EndpointList {
  endpoints: Endpoint[];
}
