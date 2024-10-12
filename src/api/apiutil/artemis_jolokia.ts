import { logger } from '../../utils/logger';
import {
  AuthenticationData,
  AuthHandler,
  AuthOptions,
  CreateAuthHandler,
  Endpoint,
} from '../../utils/security_util';
import fetch from 'node-fetch';

// search the broker
const brokerSearchPattern = 'org.apache.activemq.artemis:broker=*';
// search all broker top level components
const brokerComponentsSearchPattern =
  'org.apache.activemq.artemis:broker="BROKER_NAME",*';
// search addresses
const addressComponentsSearchPattern =
  'org.apache.activemq.artemis:broker="BROKER_NAME",component=addresses,address=*';
const acceptorComponentsSearchPattern =
  'org.apache.activemq.artemis:broker="BROKER_NAME",component=acceptors,name=*';
const queueComponentsSearchPattern =
  'org.apache.activemq.artemis:broker=*,component=addresses,address="ADDRESS_NAME",subcomponent=queues,*';
// search cluster connections
const clusterConnectionComponentsSearchPattern =
  'org.apache.activemq.artemis:broker="BROKER_NAME",component=cluster-connections,name=*';

// list a Queue's operations and attributes
const queueDetailsListPattern =
  'org.apache.activemq.artemis:address="ADDRESS_NAME",broker="BROKER_NAME",component=addresses,queue="QUEUE_NAME",routing-type="ROUTING_TYPE"/subcomponent=queues';
const addressDetailsListPattern =
  'org.apache.activemq.artemis:address="ADDRESS_NAME",broker="BROKER_NAME"/component=addresses';
const acceptorDetailsListPattern =
  'org.apache.activemq.artemis:name="ACCEPTOR_NAME",broker="BROKER_NAME"/component=acceptors';
const clusterConnectionDetailsListPattern =
  'org.apache.activemq.artemis:name="CLUSTER_CONNECTION_NAME",broker="BROKER_NAME"/component=cluster-connections';

const brokerDetailsListPattern =
  'org.apache.activemq.artemis/broker="BROKER_NAME"';

const brokerComponentPattern =
  'org.apache.activemq.artemis:broker="BROKER_NAME"';
const addressComponentPattern =
  'org.apache.activemq.artemis:broker="BROKER_NAME",component=addresses,address="ADDRESS_NAME"';
const acceptorComponentPattern =
  'org.apache.activemq.artemis:broker="BROKER_NAME",component=acceptors,name="ACCEPTOR_NAME"';
const queueComponentPattern =
  'org.apache.activemq.artemis:address="ADDRESS_NAME",broker="BROKER_NAME",component=addresses,queue="QUEUE_NAME",routing-type="ROUTING_TYPE",subcomponent=queues';
const clusterConnectionComponentPattern =
  'org.apache.activemq.artemis:broker="BROKER_NAME",component=cluster-connections,name="CLUSTER_CONNECTION_NAME"';

export const BROKER = 'broker';
export const BROKER_DETAILS = 'broker-details';
export const BROKER_COMPONENTS = 'broker-components';
export const ADDRESS = 'address';
export const QUEUE = 'queue';
export const ACCEPTOR = 'acceptor';
export const QUEUE_DETAILS = 'queue-details';
export const ADDRESS_DETAILS = 'address-details';
export const ACCEPTOR_DETAILS = 'acceptor-details';
export const CLUSTER_CONNECTION_DETAILS = 'cluster-connection-details';
export const CLUSTER_CONNECTION = 'cluster-connection';

export class ArtemisJolokia {
  readonly name: string;
  readonly serverUrl: string;
  readonly protocol: string;
  readonly port: string;
  readonly hostName: string;
  brokerName: string;
  baseUrl: string;
  authHandlers: Array<AuthHandler>;

  componentMap = new Map<string, string>([
    [BROKER, brokerSearchPattern],
    [BROKER_COMPONENTS, brokerComponentsSearchPattern],
    [ADDRESS, addressComponentsSearchPattern],
    [QUEUE, queueComponentsSearchPattern],
    [ACCEPTOR, acceptorComponentsSearchPattern],
    [CLUSTER_CONNECTION, clusterConnectionComponentsSearchPattern],
  ]);

  componentDetailsMap = new Map<string, string>([
    [BROKER_DETAILS, brokerDetailsListPattern],
    [QUEUE_DETAILS, queueDetailsListPattern],
    [ADDRESS_DETAILS, addressDetailsListPattern],
    [ACCEPTOR_DETAILS, acceptorDetailsListPattern],
    [CLUSTER_CONNECTION_DETAILS, clusterConnectionDetailsListPattern],
  ]);

  componentNameMap = new Map<string, string>([
    [BROKER, brokerComponentPattern],
    [ADDRESS, addressComponentPattern],
    [ACCEPTOR, acceptorComponentPattern],
    [QUEUE, queueComponentPattern],
    [CLUSTER_CONNECTION, clusterConnectionComponentPattern],
  ]);

  constructor(endpoint: Endpoint) {
    const url = new URL(endpoint.url);

    this.name = endpoint.name;
    this.protocol = url.protocol.substring(0, url.protocol.length - 1);
    this.port = url.port
      ? url.port
      : ArtemisJolokia.getDefaultPort(this.protocol);
    this.hostName = url.hostname;
    this.brokerName = '';
    this.serverUrl = this.protocol + '://' + this.hostName + ':' + this.port;

    this.baseUrl =
      this.serverUrl + ArtemisJolokia.makeJolokiaPrefix(endpoint.jolokiaPrefix);

    this.createAuthHandlers(endpoint.auth);
  }

  createAuthHandlers = (auth: AuthenticationData[]) => {
    this.authHandlers = new Array<AuthHandler>();
    auth.forEach((authData) => {
      this.authHandlers.push(CreateAuthHandler(authData));
    });
  };

  static makeJolokiaPrefix = (input: string) => {
    if (!input) {
      return '/console/jolokia/';
    }
    if (!input.startsWith('/')) {
      input = '/' + input;
    }
    if (!input.endsWith('/')) {
      input = input + '/';
    }
    return input;
  };

  static getDefaultPort = (prot: string): string => {
    if (prot === 'https') {
      return '443';
    }
    return '80';
  };

  validateBroker = async (): Promise<boolean> => {
    const result = await this.getComponents(BROKER);
    if (result.length === 1 && result[0].length > 0) {
      //org.apache.activemq.artemis:broker="amq-broker"
      this.brokerName = result[0].split('=', 2)[1];

      //remove quotes
      this.brokerName = this.brokerName.replace(/"/g, '');
      return true;
    }
    return false;
  };

  prepareRequest(reqUrl: string): AuthOptions {
    const headers = new fetch.Headers();
    headers.set('Origin', this.serverUrl);
    const authOpts = {
      headers: headers,
    };
    this.authHandlers.forEach((handler) => {
      handler.handleRequest(reqUrl, authOpts);
    });
    return authOpts;
  }

  getComponents = async (
    name: string,
    params?: Map<string, string>,
  ): Promise<Array<string>> => {
    let searchPattern = this.componentMap.get(name);

    if (typeof params !== 'undefined') {
      for (const [key, value] of params) {
        searchPattern = searchPattern?.replace(key, value);
      }
    }

    searchPattern = searchPattern?.replace('BROKER_NAME', this.brokerName);

    const url = this.baseUrl + 'search/' + searchPattern;

    const { headers, agent } = this.prepareRequest(url);

    const reply = await fetch(url, {
      method: 'GET',
      headers: headers,
      agent: agent ?? false,
    })
      .then((response) => {
        logger.debug(
          { response: response.ok, status: response.statusText },
          'response from endpoint',
        );
        if (response.ok) {
          return response.text();
        }
        throw response;
      })
      .then((message) => {
        const resp: JolokiaResponseType = JSON.parse(message);
        return resp.value;
      });

    return reply;
  };

  getBrokerDetails = async (): Promise<JolokiaObjectDetailsType> => {
    let searchPattern = this.componentDetailsMap.get(BROKER_DETAILS);

    searchPattern = searchPattern?.replace('BROKER_NAME', this.brokerName);

    const url = this.baseUrl + 'list/' + searchPattern;

    const { headers, agent } = this.prepareRequest(url);

    const reply = await fetch(url, {
      method: 'GET',
      headers: headers,
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      })
      .then((message) => {
        const resp: JolokiaListResponseType = JSON.parse(message);
        if (resp.status !== 200) {
          throw resp.error;
        }
        return resp.value;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  getAcceptorDetails = async (
    params?: Map<string, string>,
  ): Promise<JolokiaObjectDetailsType> => {
    let searchPattern = this.componentDetailsMap.get(ACCEPTOR_DETAILS);

    if (typeof params !== 'undefined') {
      for (const [key, value] of params) {
        searchPattern = searchPattern?.replace(key, value);
      }
    }
    searchPattern = searchPattern?.replace('BROKER_NAME', this.brokerName);

    const url = this.baseUrl + 'list/' + searchPattern;

    const { headers, agent } = this.prepareRequest(url);

    const reply = await fetch(url, {
      method: 'GET',
      headers: headers,
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      })
      .then((message) => {
        const resp: JolokiaListResponseType = JSON.parse(message);
        if (resp.status !== 200) {
          throw resp.error;
        }
        return resp.value;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  getAddressDetails = async (
    params?: Map<string, string>,
  ): Promise<JolokiaObjectDetailsType> => {
    let searchPattern = this.componentDetailsMap.get(ADDRESS_DETAILS);

    if (typeof params !== 'undefined') {
      for (const [key, value] of params) {
        searchPattern = searchPattern?.replace(key, value);
      }
    }
    searchPattern = searchPattern?.replace('BROKER_NAME', this.brokerName);

    const url = this.baseUrl + 'list/' + searchPattern;

    const { headers, agent } = this.prepareRequest(url);

    const reply = await fetch(url, {
      method: 'GET',
      headers: headers,
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      })
      .then((message) => {
        const resp: JolokiaListResponseType = JSON.parse(message);
        if (resp.status !== 200) {
          throw resp.error;
        }
        return resp.value;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  getClusterConnectionDetails = async (
    params?: Map<string, string>,
  ): Promise<JolokiaObjectDetailsType> => {
    let searchPattern = this.componentDetailsMap.get(
      CLUSTER_CONNECTION_DETAILS,
    );

    if (typeof params !== 'undefined') {
      for (const [key, value] of params) {
        searchPattern = searchPattern?.replace(key, value);
      }
    }
    searchPattern = searchPattern?.replace('BROKER_NAME', this.brokerName);

    const url = this.baseUrl + 'list/' + searchPattern;

    const { headers, agent } = this.prepareRequest(url);

    const reply = await fetch(url, {
      method: 'GET',
      headers: headers,
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      })
      .then((message) => {
        const resp: JolokiaListResponseType = JSON.parse(message);
        if (resp.status !== 200) {
          throw resp.error;
        }
        return resp.value;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  readBrokerAttributes = async (
    brokerAttrNames: string[],
  ): Promise<JolokiaReadResponse[]> => {
    const { headers, agent } = this.prepareRequest(this.baseUrl);
    headers.set('Content-Type', 'application/json');

    const reply = await fetch(this.baseUrl, {
      method: 'POST',
      headers: headers,
      body: this.getPostBodyForAttributes(
        BROKER,
        new Map<string, string>(),
        brokerAttrNames,
      ),
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      }) //directly use json()?
      .then((message) => {
        const resp: JolokiaReadResponse[] = JSON.parse(message);
        return resp;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  readAddressAttributes = async (
    addressName: string,
    addressAttrNames: string[],
  ): Promise<JolokiaReadResponse[]> => {
    const { headers, agent } = this.prepareRequest(this.baseUrl);
    headers.set('Content-Type', 'application/json');

    const param = new Map<string, string>();
    param.set('ADDRESS_NAME', addressName);

    const reply = await fetch(this.baseUrl, {
      method: 'POST',
      headers: headers,
      body: this.getPostBodyForAttributes(ADDRESS, param, addressAttrNames),
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      }) //directly use json()?
      .then((message) => {
        const resp: JolokiaReadResponse[] = JSON.parse(message);
        return resp;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  readClusterConnectionAttributes = async (
    clusterConnectionName: string,
    clusterConnectionAttrNames: string[],
  ): Promise<JolokiaReadResponse[]> => {
    const { headers, agent } = this.prepareRequest(this.baseUrl);
    headers.set('Content-Type', 'application/json');

    const param = new Map<string, string>();
    param.set('CLUSTER_CONNECTION_NAME', clusterConnectionName);

    const reply = await fetch(this.baseUrl, {
      method: 'POST',
      headers: headers,
      body: this.getPostBodyForAttributes(
        CLUSTER_CONNECTION,
        param,
        clusterConnectionAttrNames,
      ),
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      }) //directly use json()?
      .then((message) => {
        const resp: JolokiaReadResponse[] = JSON.parse(message);
        return resp;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  execClusterConnectionOperation = async (
    param: Map<string, string>,
    signature: string,
    args: string[],
  ): Promise<JolokiaExecResponse> => {
    const { headers, agent } = this.prepareRequest(this.baseUrl);
    headers.set('Content-Type', 'application/json');

    const reply = await fetch(this.baseUrl, {
      method: 'POST',
      headers: headers,
      body: this.getPostBodyForOperation(
        CLUSTER_CONNECTION,
        param,
        signature,
        args,
      ),
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.json();
        } else {
          throw response;
        }
      })
      .then((jsonObj) => {
        return jsonObj as JolokiaExecResponse;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  execBrokerOperation = async (
    signature: string,
    args: string[],
  ): Promise<JolokiaExecResponse> => {
    const { headers, agent } = this.prepareRequest(this.baseUrl);
    headers.set('Content-Type', 'application/json');

    const reply = await fetch(this.baseUrl, {
      method: 'POST',
      headers: headers,
      body: this.getPostBodyForOperation(
        BROKER,
        new Map<string, string>(),
        signature,
        args,
      ),
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.json();
        } else {
          throw response;
        }
      })
      .then((jsonObj) => {
        return jsonObj as JolokiaExecResponse;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  getQueueDetails = async (
    params?: Map<string, string>,
  ): Promise<JolokiaObjectDetailsType> => {
    let searchPattern = this.componentDetailsMap.get(QUEUE_DETAILS);

    if (typeof params !== 'undefined') {
      for (const [key, value] of params) {
        searchPattern = searchPattern?.replace(key, value);
      }
    }
    searchPattern = searchPattern?.replace('BROKER_NAME', this.brokerName);

    const url = this.baseUrl + 'list/' + searchPattern;

    const { headers, agent } = this.prepareRequest(url);

    const reply = await fetch(url, {
      method: 'GET',
      headers: headers,
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      }) //directly use json()?
      .then((message) => {
        const resp: JolokiaListResponseType = JSON.parse(message);
        if (resp.status !== 200) {
          throw resp.error;
        }
        return resp.value;
      })
      .catch((err) => {
        throw err;
      });

    return reply;
  };

  readQueueAttributes = async (
    queueName: string,
    routingType: string,
    addressName: string,
    queueAttrNames: string[],
  ): Promise<JolokiaReadResponse[]> => {
    const { headers, agent } = this.prepareRequest(this.baseUrl);
    headers.set('Content-Type', 'application/json');

    const param = new Map<string, string>();
    param.set('QUEUE_NAME', queueName);
    param.set('ROUTING_TYPE', routingType);
    param.set('ADDRESS_NAME', addressName);

    const reply = await fetch(this.baseUrl, {
      method: 'POST',
      headers: headers,
      body: this.getPostBodyForAttributes(QUEUE, param, queueAttrNames),
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      }) //directly use json()?
      .then((message) => {
        const resp: JolokiaReadResponse[] = JSON.parse(message);
        return resp;
      })
      .catch((err) => {
        throw err;
      });
    return reply;
  };

  readAcceptorAttributes = async (
    acceptorName: string,
    acceptorAttrNames: string[],
  ): Promise<JolokiaReadResponse[]> => {
    const { headers, agent } = this.prepareRequest(this.baseUrl);
    headers.set('Content-Type', 'application/json');

    const param = new Map<string, string>();
    param.set('ACCEPTOR_NAME', acceptorName);

    const reply = await fetch(this.baseUrl, {
      method: 'POST',
      headers: headers,
      body: this.getPostBodyForAttributes(ACCEPTOR, param, acceptorAttrNames),
      agent: agent ?? false,
    })
      .then((response) => {
        if (response.ok) {
          return response.text();
        }
        throw response;
      }) //directly use json()?
      .then((message) => {
        const resp: JolokiaReadResponse[] = JSON.parse(message);
        return resp;
      })
      .catch((err) => {
        throw err;
      });
    return reply;
  };

  getPostBodyForAttributes = (
    component: string,
    params?: Map<string, string>,
    attrs?: string[],
  ): string => {
    const bodyItems: JolokiaPostReadBodyItem[] = [];
    let bean = this.componentNameMap.get(component) as string;
    if (!bean) {
      throw 'undefined bean';
    }
    if (params !== undefined) {
      for (const [key, value] of params) {
        bean = bean.replace(key, value);
      }
    }
    bean = bean.replace('BROKER_NAME', this.brokerName);
    if (attrs) {
      attrs.map((attr) => {
        bodyItems.push({
          type: 'read',
          mbean: bean,
          attribute: attr,
        });
      });
      return JSON.stringify(bodyItems);
    }
    return JSON.stringify([{ type: 'read', mbean: bean }]);
  };

  getPostBodyForOperation = (
    component: string,
    params: Map<string, string>,
    signature: string,
    args?: string[],
  ): string => {
    const bodyItems: JolokiaPostExecBodyItem[] = [];
    let bean = this.componentNameMap.get(component) as string;
    if (!bean) {
      throw 'undefined bean';
    }
    bean = bean.replace('BROKER_NAME', this.brokerName);
    params.forEach((value, key) => {
      bean = bean.replace(key, value);
    });

    bodyItems.push({
      type: 'exec',
      mbean: bean,
      operation: signature,
      arguments: args ? args : [],
    });

    return JSON.stringify(bodyItems);
  };
}

const validateEndpoint = (endpoint: Endpoint) => {
  if (!endpoint.name) {
    throw Error('No endpoint name');
  }
  if (!endpoint.auth) {
    throw Error('No endpoint authentication data');
  }
  if (!endpoint.url) {
    throw Error('No endpoint url');
  }
};

export const CreateArtemisJolokia = (endpoint: Endpoint): ArtemisJolokia => {
  validateEndpoint(endpoint);
  return new ArtemisJolokia(endpoint);
};

interface JolokiaPostReadBodyItem {
  type: string;
  mbean: string;
  attribute?: string;
  path?: string;
}

interface JolokiaPostExecBodyItem {
  type: string;
  mbean: string;
  operation: string;
  arguments?: string[];
}

interface JolokiaRequestType {
  mbean: string;
  type: string;
}

export interface JolokiaResponseType {
  request: JolokiaRequestType;
  value: any;
  timestamp: number;
  status: number;
  error?: string;
  error_type?: string;
}

interface JolokiaListRequestType {
  path: string;
  type: string;
}

type JavaTypes =
  | 'java.lang.Object'
  | 'java.lang.String'
  | 'boolean'
  | 'java.util.Map'
  | 'int'
  | 'long'
  | 'double'
  | 'void';

interface Argument {
  name: string;
  type: JavaTypes;
  desc: string;
}

export interface Op {
  args: Argument[];
  ret?: JavaTypes;
  desc: string;
}

export interface Attr {
  rw: boolean;
  type: JavaTypes;
  desc: string;
}

export interface JolokiaObjectDetailsType {
  op: { [key: string]: Op | Op[] };
  attr: { [key: string]: Attr };
  class: string;
  desc: string;
}

interface JolokiaListResponseType {
  request: JolokiaListRequestType;
  value: JolokiaObjectDetailsType;
  timestamp: number;
  status: number;
  error?: string;
  error_type?: string;
}

export interface JolokiaReadResponse {
  request: JolokiaRequestType;
  value: Map<string, any>;
  timestamp: number;
  status: number;
  error?: string;
  error_type?: string;
}

export interface JolokiaExecResponse {
  request: JolokiaRequestType;
  value: any;
  timestamp: number;
  status: number;
  error?: string;
  error_type?: string;
}
