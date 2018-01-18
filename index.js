#!/usr/bin/env node

const yargs = require('yargs')
        .usage('Watch a CloudFormation stack update. Press q to quit.\nUsage: $0')
        .alias('H', 'help')
        .describe('help', 'Print usage and quit.')
        .alias('s', 'stackName')
        .describe('stackName', 'CloudFormation Stack Name')
        .required('stackName', true)
        .alias('w', 'waitSeconds')
        .describe('waitSeconds', 'Number of seconds to wait between polls')
        .default('waitSeconds', 5)
        .alias('r', 'region')
        .describe('region', 'AWS Region that contains the stack')
        .default('region', 'us-east-1')
    ,
    argv = yargs.argv;

if (argv.H) {
    yargs.showHelp();
    process.exit(0);
}


var WatchStack = require('./lib/WatchStack');

let program = new WatchStack.WatchStack(argv);
program.startPolling();