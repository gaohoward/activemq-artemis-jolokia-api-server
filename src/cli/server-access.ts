import { ApiClient } from './api-client';
import { JolokiaEndpoint } from './context';

class JolokiaClient extends ApiClient {
  PrepareFetchUrl(path: string) {
    return new URL(`${this.Config.baseUrl}/${path}`.replace(/\/{2,}/g, '/'));
  }
}

export class ServerAccess {
  apiClient: JolokiaClient;

  constructor(apiServerUrl: string) {
    this.apiClient = new JolokiaClient({
      baseUrl: apiServerUrl + '/api/v1/',
    });
  }

  login = async (currentEndpoint: JolokiaEndpoint) => {
    return this.apiClient.security.login(currentEndpoint);
  };

  checkApiServer = async (): Promise<boolean> => {
    return this.apiClient.development
      .apiInfo()
      .then((value) => {
        if (value.status === 'successful') {
          return true;
        }
        return false;
      })
      .catch(() => {
        return false;
      });
  };

  updateClientHeader = (name: string, accessToken: string) => {
    this.apiClient.Config.headers = {
      ...this.apiClient.Config.headers,
      'jolokia-session-id': accessToken,
    };
  };

  updateBearerToken(bearerToken: string) {
    this.apiClient.Config.headers = {
      ...this.apiClient.Config.headers,
      Authorization: 'Bearer ' + bearerToken,
    };
  }

  loginServer = async (userName: string, password: string) => {
    return this.apiClient.security.serverLogin({ userName, password });
  };

  getBrokerComponents = async () => {
    return this.apiClient.jolokia.getBrokerComponents();
  };

  getQueues = async () => {
    return this.apiClient.jolokia.getQueues({});
  };

  getAddresses = async () => {
    return this.apiClient.jolokia.getAddresses();
  };

  getAcceptors = async () => {
    return this.apiClient.jolokia.getAcceptors();
  };

  getClusterConnections = async () => {
    return this.apiClient.jolokia.getClusterConnections();
  };

  readBrokerAttributes = async (
    opts: { names?: undefined } | { names: string[] },
  ) => {
    return this.apiClient.jolokia.readBrokerAttributes(opts);
  };

  readQueueAttributes = async (
    opts:
      | {
          name: string;
          address: string;
          'routing-type': string;
          attrs?: undefined;
        }
      | {
          name: string;
          address: string;
          'routing-type': string;
          attrs: string[];
        },
  ) => {
    return this.apiClient.jolokia.readQueueAttributes(opts);
  };

  readAddressAttributes = async (
    opts:
      | { name: string; attrs?: undefined }
      | { name: string; attrs: string[] },
  ) => {
    return this.apiClient.jolokia.readAddressAttributes(opts);
  };

  readAcceptorAttributes = async (
    opts:
      | { name: string; attrs?: undefined }
      | { name: string; attrs: string[] },
  ) => {
    return this.apiClient.jolokia.readAcceptorAttributes(opts);
  };

  readClusterConnectionAttributes = async (
    opts:
      | { name: string; attrs?: undefined }
      | { name: string; attrs: string[] },
  ) => {
    return this.apiClient.jolokia.readClusterConnectionAttributes(opts);
  };

  getBrokers = async () => {
    return this.apiClient.jolokia
      .getBrokers()
      .then((result) => {
        return result;
      })
      .catch((ex) => {
        throw ex;
      });
  };
}
