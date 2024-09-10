import { Command } from 'commander';
import { ApiClient } from './api-client';

class JolokiaClient extends ApiClient {
  PrepareFetchUrl(path: string) {
    return new URL(`${this.Config.baseUrl}/${path}`.replace(/\/{2,}/g, '/'));
  }
}

export interface JolokiaEndpoint {
  brokerName: string;
  userName: string;
  password: string;
  jolokiaHost: string;
  scheme: string;
  port: string;
  accessToken: string;
}

export const printResult = (result: object) => {
  console.log(JSON.stringify(result, null, 2));
};

export const printError = (message: string, detail?: object | string) => {
  console.error(
    JSON.stringify({
      message: 'Error: ' + message,
      detail: detail ? detail : '',
    }),
  );
};

export class CommandContext {
  apiClient: JolokiaClient;
  currentEndpoint: JolokiaEndpoint;
  apiServerUrl: string;

  constructor(
    apiServerUrl: string,
    endpointUrl: string,
    endpoint: JolokiaEndpoint | null,
  ) {
    this.apiClient = new JolokiaClient({
      baseUrl: apiServerUrl,
    });
    this.apiServerUrl = apiServerUrl;

    if (endpointUrl !== '') {
      const url = new URL(endpointUrl);
      this.currentEndpoint = {
        brokerName: 'current',
        userName: url.username,
        password: url.password,
        jolokiaHost: url.hostname,
        scheme: url.protocol.substring(0, url.protocol.length - 1),
        port: this.getActualPort(url),
        accessToken: '',
      };
    } else {
      this.currentEndpoint = endpoint as JolokiaEndpoint;
    }
  }

  getActualPort(url: URL): string {
    return url.port === ''
      ? url.protocol === 'http:'
        ? '80'
        : '443'
      : url.port;
  }

  async login(): Promise<number> {
    if (
      this.currentEndpoint !== null &&
      this.currentEndpoint.accessToken !== ''
    ) {
      return 0;
    }
    const result = await this.apiClient.security.login(this.currentEndpoint);
    if (result.status === 'success') {
      const accessToken = result['jolokia-session-id'];
      this.apiClient.Config.headers = {
        ...this.apiClient.Config.headers,
        'jolokia-session-id': accessToken,
      };
      this.currentEndpoint.accessToken = accessToken;
      return 0;
    }
    return 1;
  }

  async processCommand(cmds: string[]): Promise<number> {
    let retValue = 0;
    cmds.forEach(async (command) => {
      const args = command.split(' ');
      switch (args[0]) {
        case 'get': {
          const getCmd = this.newGetCmd();
          try {
            await getCmd.parseAsync(args, { from: 'electron' });
          } catch (e) {
            printError('failed to execut get command', e);
            retValue = 1;
          }
          break;
        }
        default:
          printError('unknown command', args[0]);
          break;
      }
    });
    return retValue;
  }

  parseGetPath(path: string): string {
    //for non-interactive mode if
    // path = '/' : to get all components of the target broker
    // path = '/<type>' : to get all components of <type>
    // path = '<type>' : same as '/<type>'
    let targetType: string;
    const pathElements = path.split('/');
    if (pathElements.length === 1) {
      targetType = pathElements[0];
    } else if (pathElements.length === 2) {
      //ignore [0] as it will be processed by interactive context
      targetType = pathElements[1];
    } else {
      throw 'Invalid target expression: ' + path;
    }
    return targetType;
  }

  newGetCmd(): Command {
    const getCmd = new Command('get')
      .description('get information from a endpoint')
      .argument('<path>', 'path of the component, [endpointName/componentType]')
      .argument('[compName]', 'name of the component', '')
      .option(
        '-a, --attributes <attributeNames...>',
        'get attributes from component',
      )
      .exitOverride()
      .showHelpAfterError()
      .action(async (path, compName, options, cmd): Promise<void> => {
        try {
          const targetType = this.parseGetPath(path);
          if (compName === '') {
            // read all comps of type
            if (targetType === '') {
              // '/' get broker info
              if (options.attributes?.length > 0) {
                await this.getComponentAttributes(
                  'broker',
                  '',
                  options.attributes[0] === '*' ? null : options.attributes,
                );
              } else {
                await this.getComponent('broker', '');
              }
            } else if (targetType === '*') {
              // '/*' to get all components
              if (options.attributes?.length > 0) {
                throw Error('cannot specify attributes for all components');
              } else {
                await this.getAllComponents('');
              }
            } else {
              // '/type' read all comps of type
              if (options.attributes?.length > 0) {
                throw 'need a component name to get attributes of';
              }
              await this.getAllComponents(targetType);
            }
          } else {
            if (options.attributes?.length > 0) {
              // '/type or type -a ...' read one comp's attributes
              await this.getComponentAttributes(
                targetType,
                compName,
                options.attributes[0] === '*' ? null : options.attributes,
              );
            } else {
              //nothing specified, just return type info
              await this.getComponent(targetType, compName);
            }
          }
        } catch (e) {
          cmd.error('error parsing targetType');
        }
      });
    return getCmd;
  }

  async getComponent(targetType: string, compName: string): Promise<number> {
    switch (targetType) {
      case 'broker':
        return await this.getBroker();
      case 'queue':
      case 'queues':
        return await this.getQueue(compName);
      case 'address':
      case 'addresses':
        return await this.getAddress(compName);
      case 'acceptor':
      case 'acceptors':
        return await this.getAcceptor(compName);
      default:
        printError('component type not supported', targetType);
        return 1;
    }
  }

  async getAllBrokerComponents(): Promise<number> {
    let retValue = 0;
    try {
      const result = await this.apiClient.jolokia.getBrokerComponents();
      printResult(result);
    } catch (ex) {
      printError('failed to get broker components', ex);
      retValue = 1;
    }
    return retValue;
  }

  async getAllQueueComponents(): Promise<number> {
    let retValue = 0;
    try {
      const result = await this.apiClient.jolokia.getQueues({});
      printResult(result);
    } catch (ex) {
      printError('failed to get queues', ex);
      retValue = 1;
    }
    return retValue;
  }

  async getAllAddresses(): Promise<number> {
    let retValue = 0;
    try {
      const result = await this.apiClient.jolokia.getAddresses();
      printResult(result);
    } catch (ex) {
      printError('failed to get addresses', ex);
      retValue = 1;
    }
    return retValue;
  }

  async getAllAcceptors(): Promise<number> {
    let retValue = 0;
    try {
      const result = await this.apiClient.jolokia.getAcceptors();
      printResult(result);
    } catch (ex) {
      printError('failed to get acceptors', ex);
      retValue = 1;
    }
    return retValue;
  }

  async getAllClusterConnections(): Promise<number> {
    throw new Error('Method not implemented.');
  }

  async getAllComponents(targetType: string): Promise<number> {
    switch (targetType) {
      case '':
        return await this.getAllBrokerComponents();
      case 'queue':
      case 'queues':
        return await this.getAllQueueComponents();
      case 'address':
      case 'addresses':
        return await this.getAllAddresses();
      case 'acceptor':
      case 'acceptors':
        return await this.getAllAcceptors();
      case 'cluster-connection':
      case 'cluster-connections':
        return await this.getAllClusterConnections();
      case 'bridge':
      case 'bridges':
        printError('not implemented!');
        return 1;
      case 'broadcast-group':
      case 'broadcast-groups':
        printError('not implemented!');
        return 1;
      default:
        printError('component type not supported', targetType);
        return 1;
    }
  }

  async getQueue(compName: string): Promise<number> {
    let retValue = 0;
    try {
      const result = await this.apiClient.jolokia.getQueues({});
      const queues = result.filter((q) => q.name === compName);
      printResult(queues);
    } catch (ex) {
      printError('failed to get queues', ex);
      retValue = 1;
    }
    return retValue;
  }

  async getAddress(compName: string): Promise<number> {
    let retValue = 0;
    try {
      const result = await this.apiClient.jolokia.getAddresses();
      const addresses = result.filter((a) => a.name === compName);
      printResult(addresses);
    } catch (ex) {
      printError('failed to get addresses', ex);
      retValue = 1;
    }
    return retValue;
  }

  async getAcceptor(compName: string): Promise<number> {
    let retValue = 0;
    try {
      const result = await this.apiClient.jolokia.getAcceptors();
      const acceptors = result.filter((a) => a.name === compName);
      printResult(acceptors);
    } catch (ex) {
      printError('failed to get acceptors', ex);
      retValue = 1;
    }
    return retValue;
  }

  async getBrokerAttributes(attributes: string[]): Promise<number> {
    let retValue = 0;
    const opts = attributes === null ? {} : { names: attributes };
    try {
      const values = await this.apiClient.jolokia.readBrokerAttributes(opts);
      printResult(values);
    } catch (e) {
      printError('failed to read attributes', e);
      retValue = 1;
    }
    return retValue;
  }

  async getQueueAttributes(
    compName: string,
    attributes: string[],
  ): Promise<number> {
    let retValue = 0;
    const result = await this.apiClient.jolokia.getQueues({});
    const queues = result.filter((q) => q.name === compName);
    queues.forEach(async (q) => {
      const opts =
        attributes === null
          ? {
              name: compName,
              address: q.address?.name,
              'routing-type': q['routing-type'],
            }
          : {
              name: compName,
              address: q.address?.name,
              'routing-type': q['routing-type'],
              attrs: attributes,
            };

      try {
        const values = await this.apiClient.jolokia.readQueueAttributes(opts);
        printResult(values);
      } catch (e) {
        printError('failed to read queue attributes', e);
        retValue = 1;
      }
    });
    return retValue;
  }

  async getAddressAttributes(
    compName: string,
    attributes: string[],
  ): Promise<number> {
    let retValue = 0;
    const opts =
      attributes === null
        ? { name: compName }
        : { name: compName, attrs: attributes };
    try {
      const values = await this.apiClient.jolokia.readAddressAttributes(opts);
      printResult(values);
    } catch (e) {
      printError('failed to read address attributes', e);
      retValue = 1;
    }
    return retValue;
  }

  async getAcceptorAttributes(
    compName: string,
    attributes: string[],
  ): Promise<number> {
    let retValue = 0;
    const opts =
      attributes === null
        ? { name: compName }
        : { name: compName, attrs: attributes };
    try {
      const values = await this.apiClient.jolokia.readAcceptorAttributes(opts);
      printResult(values);
    } catch (e) {
      printError('failed to read acceptor attributes', e);
      retValue = 1;
    }
    return retValue;
  }

  async getComponentAttributes(
    targetType: string,
    compName: string,
    attributes: string[],
  ): Promise<number> {
    switch (targetType) {
      case 'broker':
        return await this.getBrokerAttributes(attributes);
      case 'queue':
      case 'queues':
        return await this.getQueueAttributes(compName, attributes);
      case 'address':
      case 'addresses':
        return await this.getAddressAttributes(compName, attributes);
      case 'acceptor':
      case 'acceptors':
        return await this.getAcceptorAttributes(compName, attributes);
      default:
        printError('Error: component type not supported', targetType);
        return 1;
    }
  }

  async getBroker(): Promise<number> {
    let retValue = 0;
    try {
      const values = await this.apiClient.jolokia.getBrokers();
      printResult(values);
    } catch (ex) {
      printError('failed to get brokers', ex);
      retValue = 1;
    }
    return retValue;
  }
}

export class InteractiveCommandContext extends CommandContext {
  readonly endpoints: Map<string, CommandContext>;

  constructor(apiServerUrl: string, endpointMap: Map<string, CommandContext>) {
    super(apiServerUrl, '', null);
    this.endpoints = endpointMap;
  }

  getPrompt(): string {
    return this.currentEndpoint?.brokerName
      ? this.currentEndpoint?.brokerName + '> '
      : '> ';
  }

  hasEndpoint(endpointName: string): boolean {
    return this.endpoints.has(endpointName);
  }

  newAddCmd(): Command {
    const addCmd = new Command('add')
      .argument('<name>', 'name of the endpoint')
      .argument('<endpoint>', 'the endpoint url')
      .option('-u, --user [userName]', 'the user name', 'user')
      .option('-p, --password [password]', 'the password', 'password')
      .exitOverride()
      .showHelpAfterError()
      .description(
        'add an jolokia endpoint, example: add mybroker0 http://localhost:8161',
      )
      .action(async (endpointName, endpointUrl, options) => {
        const url = new URL(endpointUrl);
        if (this.hasEndpoint(endpointName)) {
          printError('endpoint already exists!');
        }

        const newEndpoint = {
          brokerName: endpointName,
          userName: options.user,
          password: options.password,
          jolokiaHost: url.hostname,
          scheme: url.protocol.substring(0, url.protocol.length - 1),
          port: this.getActualPort(url),
          accessToken: '',
        };
        const context = new CommandContext(this.apiServerUrl, '', newEndpoint);
        try {
          await context.login();
          context.currentEndpoint.brokerName = endpointName;
          this.endpoints.set(endpointName, context);
          this.switchContext(context);
        } catch (ex) {
          printError('failed to login', ex);
        }
      });

    return addCmd;
  }

  async addEndpoint(args: string[]): Promise<number> {
    let retValue = 0;
    const addCmd = this.newAddCmd();
    try {
      await addCmd.parseAsync(args, { from: 'electron' }).catch(() => {
        //commander would print the error message
        retValue = 1;
      });
    } catch (ex) {
      printError('failed to execute add command', ex);
      retValue = 1;
    }
    return retValue;
  }

  getEndpoint(endpointName: string): CommandContext | undefined {
    return this.endpoints.get(endpointName);
  }

  listJolokiaEndpoints(): number {
    printResult(Object.fromEntries(this.endpoints));
    return 0;
  }

  switchContext(target: CommandContext) {
    this.apiClient = target.apiClient;
    this.currentEndpoint = target.currentEndpoint;
  }

  newSwitchCmd(): Command {
    const switchCmd = new Command('switch')
      .argument('<endpointName>')
      .description('switch to a jolokia endpoint')
      .exitOverride()
      .action(async (endpointName) => {
        if (!this.hasEndpoint(endpointName)) {
          printError('no such endpoint', endpointName);
        } else {
          const target = this.getEndpoint(endpointName) as CommandContext;
          this.switchContext(target);
        }
      });
    return switchCmd;
  }

  async switchJolokiaEndpoint(args: string[]): Promise<number> {
    let retValue = 0;
    const switchCmd = this.newSwitchCmd();
    try {
      switchCmd.parse(args, { from: 'electron' });
    } catch (ex) {
      printError('failed to execute switch command', ex);
      retValue = 1;
    }
    return retValue;
  }

  getContextForCmd(path: string): CommandContext {
    if (this.endpoints.size === 0) {
      throw Error('there is no endpoint for command');
    }
    if (!path) {
      return this;
    }
    const elements = path.split('/');
    if (elements.length === 2 && elements[0] !== '') {
      if (this.hasEndpoint(elements[0])) {
        if (elements[0] === this.currentEndpoint?.brokerName) {
          return this;
        } else {
          return this.getEndpoint(elements[0]) as CommandContext;
        }
      } else {
        throw Error('target endpoint not exist: ' + elements[0]);
      }
    }
    return this;
  }

  async processSingleCommand(cmd: string): Promise<number> {
    const args = cmd.trim().split(' ');
    switch (args[0]) {
      case '':
        return 0;
      case 'add':
        return await this.addEndpoint(args);
      case 'list':
        return this.listJolokiaEndpoints();
      case 'switch':
        return this.switchJolokiaEndpoint(args);
      default: {
        let context;
        try {
          context = this.getContextForCmd(args[1]);
        } catch (ex) {
          printError('failed to get context', ex);
          return 1;
        }
        return await context.processCommand([cmd.trim()]);
      }
    }
  }
}
