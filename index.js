#!/usr/bin/env node

var WatchStack = require('./lib/WatchStack');

let program = new WatchStack();
program.startPolling();