import yaml from 'js-yaml';
import { EndpointList } from '../../utils/security_util';
import fs from 'fs';
import {
  ArtemisJolokia,
  CreateArtemisJolokia,
} from '../apiutil/artemis_jolokia';
import { logger } from '../../utils/logger';

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
        try {
          const jolokia = CreateArtemisJolokia(endpoint);
          endpointsMap.set(endpoint.name, jolokia);
        } catch (err) {
          logger.warn(
            err,
            'failed to load endpoint (make sure your endpoint config is correct)',
          );
        }
      });
    }
    return endpointsMap;
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
