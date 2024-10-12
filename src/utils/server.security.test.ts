import https from 'https';
import fs from 'fs';
import path from 'path';
import createServer from './server';
import nock from 'nock';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { logger } from './logger';
import { IsSecurityEnabled } from '../api/controllers/security_manager';

dotenv.config({ path: '.test.env' });

let testServer: https.Server;
let mockJolokia: nock.Scope;

const apiUrlBase = 'https://localhost:9444/api/v1';
const apiUrlPrefix = '/console/jolokia';
const loginUrl = apiUrlBase + '/jolokia/login';
const serverLoginUrl = apiUrlBase + '/server/login';
const jolokiaProtocol = 'https';
const jolokiaHost = 'broker-0.test.com';
const jolokiaPort = '8161';

const startApiServer = async (): Promise<boolean> => {
  process.env.API_SERVER_SECURITY_ENABLED = 'true';

  const result = await createServer(false)
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
  token: string,
  authToken: string,
): Promise<fetch.Response> => {
  const fullUrl = apiUrlBase + url;
  const encodedUrl = fullUrl.replace(/,/g, '%2C');
  const response = await fetch(encodedUrl, {
    method: 'GET',
    headers: {
      'jolokia-session-id': token,
      Authorization: 'Bearer ' + authToken,
    },
  });
  return response;
};

const doPost = async (
  url: string,
  postBody: fetch.BodyInit,
  token: string,
  authToken: string,
): Promise<fetch.Response> => {
  const fullUrl = apiUrlBase + url;
  const encodedUrl = fullUrl.replace(/,/g, '%2C');

  const reply = await fetch(encodedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'jolokia-session-id': token,
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
  response: fetch.Response;
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

  return { response: response, authToken: bearerToken as string };
};

const doLogin = async (user: string, pass: string): Promise<LoginResult> => {
  return doServerLogin(user, pass).then(async (res) => {
    if (!res.response.ok) {
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
        Authorization: 'Bearer ' + res.authToken,
      },
      body: formData,
    });
    return { response: res1, authToken: res.authToken };
  });
};

describe('test api server login', () => {
  it('test login functionality', async () => {
    const result = await doLogin('user1', 'password');

    expect(result.response.ok).toBeTruthy();
    const data = await result.response.json();

    expect(data['jolokia-session-id'].length).toBeGreaterThan(0);
    expect(result.authToken.length).toBeGreaterThan(0);
  });

  it('test login failure', async () => {
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

    const result = await doLogin('user1', 'password');

    expect(result.response.ok).toBeFalsy();
  });
});

describe('test direct proxy access', () => {
  let accessToken: string;
  let bearerToken: string;

  beforeAll(async () => {
    const result = await doLogin('user1', 'password');
    const data = await result.response.json();
    accessToken = data['jolokia-session-id'];
    bearerToken = result.authToken;
    expect(accessToken.length).toBeGreaterThan(0);
    expect(bearerToken.length).toBeGreaterThan(0);
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

    const resp = await doGet('/brokers', accessToken, bearerToken);
    expect(resp.ok).toBeTruthy();

    const value = await resp.json();
    expect(value.length).toEqual(1);
    expect(value[0]).toEqual(result[0]);
  });
});
/*
describe('endpoints authorization test', () => {

  it('test user1', async () => {
    const result = await doServerLogin('user1', 'password');

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

    const resp = await doGet('/brokers', accessToken, bearerToken);
    expect(resp.ok).toBeTruthy();

    const value = await resp.json();
    expect(value.length).toEqual(1);
    expect(value[0]).toEqual(result[0]);
  });
});
*/
