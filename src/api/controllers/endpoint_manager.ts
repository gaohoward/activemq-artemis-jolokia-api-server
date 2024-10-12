import yaml from 'js-yaml';
import { Endpoint, EndpointList } from '../../utils/security_util';
import fs from 'fs';
import { ArtemisJolokia } from '../apiutil/artemis_jolokia';

export class EndpointManager {
  // endpoint name => endpoint
  endpointsMap: Map<string, ArtemisJolokia>;

  start = async () => {
    this.endpointsMap = EndpointManager.loadEndpoints(
      process.env.USERS_FILE_URL
        ? process.env.ENDPOINTS_FILE_URL
        : '.endpoints.json',
    );
  };

  static loadEndpoints = (fileUrl: string): Map<string, ArtemisJolokia> => {
    const endpointsMap = new Map<string, ArtemisJolokia>();
    if (fs.existsSync(fileUrl)) {
      const fileContents = fs.readFileSync(fileUrl, 'utf8');
      const data = yaml.load(fileContents) as EndpointList;
      data?.endpoints?.forEach((endpoint) => {
        endpointsMap.set(
          endpoint.name,
          EndpointManager.createJolokia(endpoint),
        );
      });
    }
    return endpointsMap;
  };

  static createJolokia = (endpoint: Endpoint): ArtemisJolokia => {
    const url = new URL(endpoint.url);
    const jolokia = new ArtemisJolokia(
      endpoint.name,
      endpoint.username,
      endpoint.password,
      url.hostname,
      url.protocol.substring(0, url.protocol.length - 1),
      url.port,
    );
    return jolokia;
  };

  listEndpoints = async (): Promise<ArtemisJolokia[]> => {
    const endpoints = new Array<ArtemisJolokia>();
    this.endpointsMap.forEach((value) => {
      endpoints.push(value);
    });
    return endpoints;
  };

  getJolokia = (targetEndpoint: string): ArtemisJolokia => {
    const endpoint = this.endpointsMap.get(targetEndpoint);
    if (endpoint) {
      return endpoint;
    }
    throw Error('no endpoint found');
  };
}

const endpointManager = new EndpointManager();

export const InitEndpoints = async () => {
  endpointManager.start();
};

export const GetEndpointManager = (): EndpointManager => {
  return endpointManager;
};
