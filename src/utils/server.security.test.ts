import https from 'https';
import fs from 'fs';
import path from 'path';
import createServer from './server';
import nock from 'nock';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { InitLoggers, logger } from './logger';
import {
  GetSecurityManager,
  IsSecurityEnabled,
} from '../api/controllers/security_manager';
import { GetEndpointManager } from '../api/controllers/endpoint_manager';

dotenv.config({ path: '.test.env' });

let testServer: https.Server;
let mockJolokia: nock.Scope;

let mockBroker1: nock.Scope;

const apiUrlBase = 'https://localhost:9444/api/v1';
const apiUrlPrefix = '/console/jolokia';
const loginUrl = apiUrlBase + '/jolokia/login';
const serverLoginUrl = apiUrlBase + '/server/login';
const jolokiaProtocol = 'https';
const jolokiaHost = 'broker-0-jolokia.test.com';
const jolokiaPort = '8161';
const jolokiaSessionKey = 'jolokia-session-id';

// see .test.endpoints.json
const broker1EndpointUrl = 'http://127.0.0.1:8161';

const startApiServer = async (): Promise<boolean> => {
  process.env.API_SERVER_SECURITY_ENABLED = 'true';

  const enableRequestLog = process.env.ENABLE_REQUEST_LOG === 'true';
  InitLoggers();

  const result = await createServer(enableRequestLog)
    .then((server) => {
      const options = {
        key: fs.readFileSync(path.join(__dirname, '../config/domain.key')),
        cert: fs.readFileSync(path.join(__dirname, '../config/domain.crt')),
      };
      testServer = https.createServer(options, server);
      testServer.listen(9444, () => {
        logger.info('Listening on https://0.0.0.0:9444');
        logger.info(
          'Security is ' + (IsSecurityEnabled() ? 'enabled' : 'disabled'),
        );
      });
      return true;
    })
    .catch((err) => {
      console.log('error starting server', err);
      return false;
    });
  return result;
};

const stopApiServer = () => {
  testServer.close();
};

const startMockJolokia = () => {
  mockJolokia = nock(jolokiaProtocol + '://' + jolokiaHost + ':' + jolokiaPort);
  mockBroker1 = nock(broker1EndpointUrl);
};

const stopMockJolokia = () => {
  nock.cleanAll();
};

beforeAll(async () => {
  const result = await startApiServer();
  expect(result).toBe(true);
  expect(testServer).toBeDefined();
  startMockJolokia();
});

afterAll(() => {
  stopApiServer();
  stopMockJolokia();
});

const doGet = async (
  url: string,
  token: string | null,
  authToken: string,
): Promise<fetch.Response> => {
  const fullUrl = apiUrlBase + url;
  const encodedUrl = fullUrl.replace(/,/g, '%2C');

  if (token) {
    const response = await fetch(encodedUrl, {
      method: 'GET',
      headers: {
        [jolokiaSessionKey]: token,
        Authorization: 'Bearer ' + authToken,
      },
    });
    return response;
  }

  const response = await fetch(encodedUrl, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + authToken,
    },
  });
  return response;
};

const doPost = async (
  url: string,
  postBody: fetch.BodyInit,
  token: string | null,
  authToken: string,
): Promise<fetch.Response> => {
  const fullUrl = apiUrlBase + url;
  const encodedUrl = fullUrl.replace(/,/g, '%2C');

  if (token) {
    const reply = await fetch(encodedUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [jolokiaSessionKey]: token,
        Authorization: 'Bearer ' + authToken,
      },
      body: postBody,
    });

    return reply;
  }
  const reply = await fetch(encodedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + authToken,
    },
    body: postBody,
  });

  return reply;
};

type LoginOptions = {
  [key: string]: string;
};

type LoginResult = {
  resp: fetch.Response;
  accessToken: string | null;
  authToken: string;
};

const doServerLogin = async (
  user: string,
  pass: string,
): Promise<LoginResult> => {
  const details: LoginOptions = {
    userName: user,
    password: pass,
  };

  const formBody: string[] = [];
  for (const property in details) {
    const encodedKey = encodeURIComponent(property);
    const encodedValue = encodeURIComponent(details[property]);
    formBody.push(encodedKey + '=' + encodedValue);
  }
  const formData = formBody.join('&');

  const response = await fetch(serverLoginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData,
  });

  const obj = await response.json();

  const bearerToken = obj.bearerToken;

  return {
    resp: response,
    accessToken: null,
    authToken: bearerToken as string,
  };
};

const doJolokiaLoginWithAuth = async (
  user: string,
  pass: string,
): Promise<LoginResult> => {
  return doServerLogin(user, pass).then(async (result) => {
    if (!result.resp.ok) {
      throw Error('failed server login');
    }

    const jolokiaResp = {
      request: {},
      value: ['org.apache.activemq.artemis:broker="amq-broker"'],
      timestamp: 1714703745,
      status: 200,
    };
    mockJolokia
      .get(apiUrlPrefix + '/search/org.apache.activemq.artemis:broker=*')
      .reply(200, JSON.stringify(jolokiaResp));

    const details: LoginOptions = {
      brokerName: 'ex-aao-0',
      userName: 'admin',
      password: 'admin',
      jolokiaHost: jolokiaHost,
      port: jolokiaPort,
      scheme: jolokiaProtocol,
    };

    const formBody: string[] = [];
    for (const property in details) {
      const encodedKey = encodeURIComponent(property);
      const encodedValue = encodeURIComponent(details[property]);
      formBody.push(encodedKey + '=' + encodedValue);
    }
    const formData = formBody.join('&');

    const res1 = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Bearer ' + result.authToken,
      },
      body: formData,
    });

    const data = await res1.json();

    return {
      resp: res1,
      accessToken: data[jolokiaSessionKey] as string,
      authToken: result.authToken,
    };
  });
};

describe('test api server login with jolokia login', () => {
  it('test login functionality', async () => {
    const result = await doJolokiaLoginWithAuth('user1', 'password');

    expect(result.resp.ok).toBeTruthy();

    expect(result?.accessToken?.length).toBeGreaterThan(0);
    expect(result.authToken.length).toBeGreaterThan(0);
  });

  it('test jolokia login failure', async () => {
    const jolokiaResp = {
      request: {},
      value: [''],
      error: 'forbidden access',
      timestamp: 1714703745,
      status: 403,
    };
    mockJolokia
      .get(apiUrlPrefix + '/search/org.apache.activemq.artemis:broker=*')
      .reply(403, JSON.stringify(jolokiaResp));

    const result = await doJolokiaLoginWithAuth('user1', 'password');

    expect(result.resp.ok).toBeFalsy();
  });

  it('test server login failure wrong user or password', async () => {
    const result = await doServerLogin('nouser', 'password');
    expect(result.resp.ok).toBeFalsy();

    const result1 = await doServerLogin('nouser', 'nopassword');
    expect(result1.resp.ok).toBeFalsy();

    const result2 = await doServerLogin('user1', 'password2');
    expect(result2.resp.ok).toBeFalsy();
  });
});

describe('test direct proxy access', () => {
  let accessToken: string;
  let jwtToken: string;

  beforeAll(async () => {
    const result = await doJolokiaLoginWithAuth('user1', 'password');
    jwtToken = result.authToken;
    expect(result?.accessToken?.length).toBeGreaterThan(0);
    accessToken = result.accessToken as string;
    expect(jwtToken.length).toBeGreaterThan(0);
  });

  it('test get brokers', async () => {
    const result = [
      {
        name: 'amq-broker',
      },
    ];
    const jolokiaResp = {
      request: {},
      value: ['org.apache.activemq.artemis:broker="amq-broker"'],
      timestamp: 1714703745,
      status: 200,
    };
    mockJolokia
      .get(apiUrlPrefix + '/search/org.apache.activemq.artemis:broker=*')
      .reply(200, JSON.stringify(jolokiaResp));

    const resp = await doGet('/brokers', accessToken, jwtToken);
    expect(resp.ok).toBeTruthy();

    const value = await resp.json();
    expect(value.length).toEqual(1);
    expect(value[0]).toEqual(result[0]);
  });
});

describe('test endpoints loading', () => {
  let jwtToken: string;

  beforeAll(async () => {
    const result = await doServerLogin('root', 'password');
    jwtToken = result.authToken;
    expect(result.accessToken).toBeNull();
    expect(jwtToken.length).toBeGreaterThan(0);
  });

  it('check endpoints are loaded', () => {
    const endpointManager = GetEndpointManager();
    expect(endpointManager.endpointsMap.size).toEqual(4);

    const jolokia1 = endpointManager.endpointsMap.get('broker1');
    expect(jolokia1).not.toBeUndefined();
    expect(jolokia1?.baseUrl).toEqual('http://127.0.0.1:8161/console/jolokia/');

    const jolokia2 = endpointManager.endpointsMap.get('broker2');
    expect(jolokia2).not.toBeUndefined();
    expect(jolokia2?.baseUrl).toEqual('http://127.0.0.2:8161/console/jolokia/');

    const jolokia3 = endpointManager.endpointsMap.get('broker3');
    expect(jolokia3).not.toBeUndefined();
    expect(jolokia3?.baseUrl).toEqual('http://127.0.0.3:8161/console/jolokia/');

    const jolokia4 = endpointManager.endpointsMap.get('broker4');
    expect(jolokia4).not.toBeUndefined();
    expect(jolokia4?.baseUrl).toEqual(
      'https://artemis-broker-jolokia-0-svc-ing-default.artemiscloud.io:443/jolokia/',
    );
  });
});

describe('check security manager', () => {
  const securityManager = GetSecurityManager();
  const securityStore = securityManager.getSecurityStore();

  it('check user role mapping', () => {
    const users = securityStore.getAllUsers();
    expect(users.size).toEqual(3);
    expect(users.has('user1')).toBeTruthy();
    expect(users.has('user2')).toBeTruthy();
    expect(users.has('root')).toBeTruthy();

    const roles = securityStore.getAllRoles();
    expect(roles.size).toEqual(3);

    const role1 = roles.get('role1');
    expect(role1?.uids.length).toEqual(1);
    expect(role1?.uids[0]).toEqual('user1');

    const role2 = roles.get('role2');
    expect(role2?.uids.length).toEqual(2);
    expect(role2?.uids[0]).toEqual('user1');
    expect(role2?.uids[1]).toEqual('user2');

    const role3 = roles.get('manager');
    expect(role3?.uids.length).toEqual(1);
    expect(role3?.uids[0]).toEqual('root');
  });
});

describe('test endpoint access with successful auth', () => {
  let jwtToken: string;

  beforeAll(async () => {
    const result = await doServerLogin('user1', 'password');
    jwtToken = result.authToken;
    expect(result.accessToken).toBeNull();
    expect(jwtToken.length).toBeGreaterThan(0);
  });

  it('test get brokers', async () => {
    const result = [
      {
        name: '127.0.0.1',
      },
    ];
    const jolokiaResp = {
      request: {},
      value: ['org.apache.activemq.artemis:broker="127.0.0.1"'],
      timestamp: 1714703745,
      status: 200,
    };

    //use persist when this path will get called more than once.
    mockBroker1
      .persist()
      .get(apiUrlPrefix + '/search/org.apache.activemq.artemis:broker=*')
      .reply(200, JSON.stringify(jolokiaResp));

    const resp = await doGet('/brokers?targetEndpoint=broker1', null, jwtToken);

    expect(resp.ok).toBeTruthy();

    const value = await resp.json();
    expect(value.length).toEqual(1);
    expect(value[0]).toEqual(result[0]);
  });

  it('test execBrokerOperation', async () => {
    const jolokiaGetResp = {
      request: {},
      value: ['org.apache.activemq.artemis:broker="127.0.0.1"'],
      timestamp: 1714703745,
      status: 200,
    };

    //use persist when this path will get called more than once.
    mockBroker1
      .persist()
      .get(apiUrlPrefix + '/search/org.apache.activemq.artemis:broker=*')
      .reply(200, JSON.stringify(jolokiaGetResp));

    const jolokiaResp = [
      {
        request: {
          mbean: 'org.apache.activemq.artemis:broker="127.0.0.1"',
          arguments: [','],
          type: 'exec',
          operation: 'listAddresses(java.lang.String)',
        },
        value:
          '$.artemis.internal.sf.my-cluster.5c0e3e93-1837-11ef-aa70-0a580ad9005f,activemq.notifications,DLQ,ExpiryQueue',
        timestamp: 1716385483,
        status: 200,
      },
    ];

    mockBroker1
      .post(apiUrlPrefix + '/', (body) => {
        if (
          body.length === 1 &&
          body[0].type === 'exec' &&
          body[0].mbean === 'org.apache.activemq.artemis:broker="127.0.0.1"' &&
          body[0].operation === 'listAddresses(java.lang.String)' &&
          body[0].arguments[0] === ','
        ) {
          return true;
        }
        return false;
      })
      .reply(200, JSON.stringify(jolokiaResp));

    const resp = await doPost(
      '/execBrokerOperation?targetEndpoint=broker1',
      JSON.stringify({
        signature: {
          name: 'listAddresses',
          args: [{ type: 'java.lang.String', value: ',' }],
        },
      }),
      null,
      jwtToken,
    );
    expect(resp.ok).toBeTruthy();

    const value = await resp.json();
    expect(JSON.stringify(value)).toEqual(JSON.stringify(jolokiaResp));
  });
});

describe('test endpoint access with permission denied', () => {
  let jwtToken: string;

  beforeAll(async () => {
    const result = await doServerLogin('user2', 'password');
    jwtToken = result.authToken;
    expect(result.accessToken).toBeNull();
    expect(jwtToken.length).toBeGreaterThan(0);
  });

  it('test get brokers get denied on broker1', async () => {
    const jolokiaResp = {
      request: {},
      value: ['org.apache.activemq.artemis:broker="amq-broker"'],
      timestamp: 1714703745,
      status: 200,
    };

    //use persist when this path will get called more than once.
    mockBroker1
      .persist() //use persist when this path will get called more than once.
      .get(apiUrlPrefix + '/search/org.apache.activemq.artemis:broker=*')
      .reply(200, JSON.stringify(jolokiaResp));

    const resp = await doGet(
      '/brokers' + '?targetEndpoint=broker1',
      null,
      jwtToken,
    );

    expect(resp.ok).not.toBeTruthy();
    expect(resp.status).toEqual(401);
  });
});
