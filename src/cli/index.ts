#! /usr/bin/env -S node --no-warnings

import { Command } from 'commander';
import figlet from 'figlet';
import readline from 'readline';
import { stdin, stdout } from 'process';
import dotenv from 'dotenv';

import {
  checkApiServer,
  CommandContext,
  InteractiveCommandContext,
  JolokiaClient,
  printError,
} from './context';

dotenv.config();

if (process.env['NODE_TLS_REJECT_UNAUTHORIZED'] !== '0') {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
}

const program = new Command();
program
  .version('1.0.0')
  .description('CLI tool for ActiveMQ Artemis Jolokia API Server')
  .argument('[command...]', 'the command to be executed')
  .option(
    '-u, --url [api-server-url]',
    'the url of api server',
    'https://localhost:9443',
  )
  .option('-i, --interactive', 'run in interactive mode', false)
  .option(
    '-e, --endpoint [endpoint]',
    'target jolokia endpoint url',
    'http://user:password@localhost/8161',
  )
  .parse(process.argv);

const apiServerUrl = program.opts().url;

const apiClient = new JolokiaClient({
  baseUrl: apiServerUrl + '/api/v1/',
});

checkApiServer(apiClient)
  .then((result) => {
    if (!result) {
      printError('The api server is not available', apiServerUrl);
      process.exit(1);
    }
  })
  .catch((e) => {
    printError('Error checking api server: ' + apiServerUrl, e);
    process.exit(1);
  });

if (program.opts().interactive) {
  const endpointMap = new Map<string, CommandContext>();
  const commandContext = new InteractiveCommandContext(
    apiServerUrl + '/api/v1/',
    endpointMap,
  );

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
  });
  program.exitOverride(); //avoid exit on error

  const runMain = async () => {
    rl.question(commandContext.getPrompt(), function (command) {
      if (command === 'exit') {
        return rl.close();
      }
      commandContext
        .processSingleCommand(command)
        .then(() => {
          runMain();
        })
        .catch((e) => {
          printError('error processing command', e);
          runMain();
        });
    });
  };
  console.log(figlet.textSync('Api Server Cli'));
  runMain();
} else {
  const commandContext = new CommandContext(
    apiServerUrl + '/api/v1/',
    program.opts().endpoint,
    null,
  );

  commandContext
    .login()
    .then(async () => {
      const result = await commandContext.processCommand(program.args);
      return result;
    })
    .catch((e) => {
      printError('failed login', e);
      program.help();
      process.exit(1);
    });
}
