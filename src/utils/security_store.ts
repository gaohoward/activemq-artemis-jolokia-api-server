import { Store } from 'fs-json-store';
import { User } from './security_util';
import { error } from 'console';
import bcrypt from 'bcrypt-ts';

export interface StoreApi {
  getUserById(id: string): Promise<User>;
  getUser(userName: string): Promise<User>;
}

export class JsonFileStore implements StoreApi {
  store: Store<any>;

  constructor(jsonFile: string) {
    this.store = new Store({ file: jsonFile });
  }

  async getUserById(id: string): Promise<User> {
    const users = (await this.store.read()) as User[];
    users.forEach((u) => {
      if (u.id === id) {
        return u;
      }
    });
    throw error('User undefined');
  }

  async getUser(userName: string): Promise<User> {
    const users = (await this.store.read()) as User[];
    users.forEach((u) => {
      if (u.email === userName) {
        return u;
      }
    });
    throw error('User undefined');
  }
}

export class AbstractStore<StoreApi> {
  store: StoreApi;
  constructor(store: StoreApi) {
    this.store = store;
  }
}

export class UserStore extends AbstractStore<StoreApi> {
  async getUserById(id: string) {
    return await this.store.getUserById(id);
  }

  async authenticate(userName: string, password: string): Promise<User> {
    const user = await this.store.getUser(userName);
    if (!bcrypt.compareSync(password, user.hash)) {
      throw error('Invalid credential');
    }
    return user;
  }
}

export class RoleStore extends AbstractStore<StoreApi> {}

export class EndpointStore extends AbstractStore<StoreApi> {}

export class AccessControlStore extends AbstractStore<StoreApi> {}

export const GetUserStore = (): UserStore => {
  const userFile = process.env.USERS_FILE_URL
    ? process.env.USERS_FILE_URL
    : '.users.json';
  return new UserStore(new JsonFileStore(userFile));
};

export const GetRoleStore = (): RoleStore => {
  const roleFile = process.env.ROLES_FILE_URL
    ? process.env.ROLES_FILE_URL
    : '.roles.json';
  return new RoleStore(new JsonFileStore(roleFile));
};

export const GetEndpointStore = (): EndpointStore => {
  const endpointFile = process.env.ENDPOINTS_FILE_URL
    ? process.env.ENDPOINTS_FILE_URL
    : '.endpoints.json';
  return new EndpointStore(new JsonFileStore(endpointFile));
};

export const GetAccessControlStore = (): AccessControlStore => {
  const aclFile = process.env.ACCESS_CONTROL_FILE_URL
    ? process.env.ACCESS_CONTROL_FILE_URL
    : '.access.json';
  return new AccessControlStore(new JsonFileStore(aclFile));
};

export const userStore = GetUserStore();
export const roleStore = GetRoleStore();
export const endpointStore = GetEndpointStore();
export const accessControlStore = GetAccessControlStore();
