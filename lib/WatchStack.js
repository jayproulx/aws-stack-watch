#!/usr/bin/env ts-node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var AWS = require("aws-sdk");
var winston = require('winston');
var util = require('util');
var blessed = require('blessed');
var contrib = require('blessed-contrib');
var colors = require('colors');
var logger = winston.createLogger({
    level: 'debug',
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});
var columns = [
    // 'PhysicalResourceId',
    'LogicalResourceId',
    'ResourceType',
    'ResourceStatus',
    'Timestamp'
];
var termWidth = process.stdout.columns || 255;
var columnWidths = [
    Math.floor(termWidth * 0.4),
    Math.floor(termWidth * 0.2),
    Math.floor(termWidth * 0.2),
    Math.floor(termWidth * 0.2),
];
var statuses = {
    'UPDATE_COMPLETE': colors.green('UPDATE_COMPLETE'),
    'UPDATE_ROLLBACK_COMPLETE': colors.green('UPDATE_ROLLBACK_COMPLETE'),
    'UPDATE_IN_PROGRESS': colors.yellow('UPDATE_IN_PROGRESS'),
    'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS': colors.yellow('UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'),
    'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS': colors.red('UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'),
    'UPDATE_ROLLBACK_IN_PROGRESS': colors.red('UPDATE_ROLLBACK_IN_PROGRESS'),
    'CREATE_COMPLETE': colors.green('CREATE_COMPLETE'),
    'CREATE_IN_PROGRESS': colors.yellow('CREATE_IN_PROGRESS'),
    'DELETE_SKIPPED': colors.grey('DELETE_SKIPPED'),
    'DELETE_COMPLETE': colors.green('DELETE_COMPLETE'),
    'DELETE_IN_PROGRESS': colors.yellow('DELETE_IN_PROGRESS')
};
var WatchStack = /** @class */ (function () {
    function WatchStack(options) {
        this.scanIndex = 0;
        this.latestEventTime = 0;
        this.options = options;
        this.options.waitSeconds = this.options.waitSeconds || 5;
        this.options.region = this.options.region || "us-east-1";
        if (!this.options.stackName) {
            throw new Error("You must provide a valid stack name. i.e. { stackName: 'us-east-1' }");
        }
        logger.info("Watching " + this.options.stackName + " in " + this.options.region + " every " + this.options.waitSeconds + " seconds.");
        this.cloudformation = new AWS.CloudFormation({ apiVersion: '2010-05-15', region: options.region });
        this.initialize();
    }
    WatchStack.prototype.startPolling = function () {
        this.poll();
    };
    WatchStack.prototype.poll = function () {
        var _this = this;
        var self = this;
        if (this.pause) {
            return;
        }
        this.setLabel("Polling");
        logger.debug("Polling");
        try {
            this.cloudformation.describeStackEvents({ StackName: this.options.stackName }, function (err, data) {
                _this.setLabel("");
                if (err) {
                    logger.error(err, err.stack);
                    process.exit(1);
                }
                else {
                    self.scanEvents(data);
                    _this.nextTimeout = setTimeout(_this.poll.bind(_this), _this.options.waitSeconds * 1000);
                }
            });
        }
        catch (error) {
            console.error("Error while connecting to cloudFormation.");
            console.error(error);
            logger.error(error);
            process.exit(1);
        }
    };
    WatchStack.prototype.setLabel = function (label) {
        if (!this.table)
            return;
        if (label && label.length) {
            label = " (" + label + ")";
        }
        this.table.setLabel(this.options.stackName + " " + label);
        this.screen.render();
    };
    WatchStack.prototype.initialize = function () {
        var self = this;
        this.screen = blessed.screen();
        this.events = [];
        this.tabularEvents = [];
        this.table = contrib.table({
            keys: true,
            fg: 'white',
            selectedFg: 'white',
            selectedBg: 'grey',
            interactive: true,
            label: this.options.stackName,
            width: '100%',
            height: '100%',
            border: {
                type: "line",
                fg: "cyan"
            },
            columnSpacing: 2,
            columnWidth: columnWidths
        });
        this.screen.key(['q', 'C-c'], function (ch, key) {
            return process.exit(0);
        });
        this.screen.key(['p'], function (ch, key) {
            if (self.pause) {
                self.resumeScanning();
            }
            else {
                self.pauseScanning();
            }
        });
        this.table.focus();
        this.screen.append(this.table);
        this.table.setData({
            headers: columns,
            data: []
        });
        this.screen.render();
        this.screen.key(['escape'], function (ch, key) {
            if (self.modal) {
                self.modal.destroy();
                self.modal = null;
            }
            self.screen.render();
        });
        this.table.rows.on('select', function (arg1, index, arg3) {
            // self.screen.destroy();
            if (self.modal) {
                self.modal.destroy();
            }
            var selected = self.events[index];
            try {
                selected.ResourceProperties = JSON.parse(selected.ResourceProperties);
            }
            catch (e) {
            }
            var formatted = util.inspect(selected, {
                colors: true,
                depth: null
            });
            // Create a box perfectly centered horizontally and vertically.
            self.modal = blessed.box({
                top: 'center',
                left: 'center',
                width: '80%',
                height: '80%',
                content: formatted,
                tags: true,
                border: {
                    type: 'line'
                },
                style: {
                    fg: 'white',
                    bg: 'black',
                    border: {
                        fg: '#f0f0f0'
                    }
                }
            });
            // Append our box to the screen.
            self.screen.append(self.modal);
            self.modal.focus();
            self.screen.render();
            // process.exit(0);
        });
    };
    WatchStack.prototype.scanEvents = function (events) {
        if (events == null)
            return;
        events.StackEvents.sort(this.sortStackEventsByTime);
        this.updateEvents(events);
        this.events.sort(this.sortStackEventsByTimeDesc);
        this.updateTabularEvents();
        this.table.setData({
            headers: columns,
            data: this.tabularEvents
        });
        this.screen.render();
        this.scanIndex++;
    };
    WatchStack.prototype.updateEvents = function (events) {
        this.queue = events;
        logger.debug("Updating events, latest event time is " + this.latestEventTime);
        while (this.queue.StackEvents.length) {
            var event = this.queue.StackEvents.shift();
            // discard events older than the newest processed event
            if (new Date(event.Timestamp).getTime() < this.latestEventTime) {
                logger.debug("Ignoring event because timestamp is " + new Date(event.Timestamp).getTime());
                // continue;
            }
            this.addOrUpdateEvent(event);
            // someone paused, don't keep looping, save the queue for the unpause
            if (this.pause) {
                return;
            }
            if (this.scanIndex > 0 && event.ResourceType == "AWS::CloudFormation::Stack" && event.ResourceStatus == "UPDATE_ROLLBACK_IN_PROGRESS") {
                this.pauseScanning();
                return;
            }
        }
    };
    WatchStack.prototype.pauseScanning = function () {
        this.setLabel("Paused");
        this.pause = true;
        clearTimeout(this.nextTimeout);
    };
    WatchStack.prototype.resumeScanning = function () {
        this.pause = false;
        var queue = this.queue;
        this.queue = null;
        this.scanEvents(queue);
        this.startPolling();
    };
    WatchStack.prototype.addOrUpdateEvent = function (resource) {
        var updated = false;
        var added = false;
        var id = 'LogicalResourceId';
        for (var i = 0; i < this.events.length; i++) {
            var currentEvent = this.events[i];
            if (currentEvent[id] == resource[id]) {
                this.events[i] = resource;
                updated = true;
            }
        }
        if (!updated) {
            this.events.push(resource);
            added = true;
        }
        if (updated || added) {
            var ts = new Date(resource.Timestamp).getTime();
            if (ts > this.latestEventTime) {
                this.latestEventTime = ts;
            }
        }
    };
    WatchStack.prototype.updateTabularEvents = function () {
        this.tabularEvents = [];
        for (var i = 0; i < this.events.length; i++) {
            var tabularResource = this.eventToArray(this.events[i]);
            this.tabularEvents.push(tabularResource);
        }
    };
    WatchStack.prototype.sortStackEventsByTime = function (s1, s2) {
        if (s1.Timestamp < s2.Timestamp) {
            return -1;
        }
        if (s1.Timestamp > s2.Timestamp) {
            return 1;
        }
        return 0;
    };
    WatchStack.prototype.sortStackEventsByTimeDesc = function (s1, s2) {
        if (s1.Timestamp < s2.Timestamp) {
            return 1;
        }
        if (s1.Timestamp > s2.Timestamp) {
            return -1;
        }
        return 0;
    };
    WatchStack.prototype.sortByLogicalResourceId = function (s1, s2) {
        var id = 'LogicalResourceId';
        var uuid1 = s1[id].toUpperCase();
        var uuid2 = s2[id].toUpperCase();
        if (uuid1 < uuid2) {
            return -1;
        }
        if (uuid1 > uuid2) {
            return 1;
        }
        // names must be equal
        return 0;
    };
    WatchStack.prototype.eventToArray = function (resource) {
        if (!resource)
            return [];
        var output = [];
        for (var i = 0; i < columns.length; i++) {
            var v = resource[columns[i]];
            if (columns[i] == 'Timestamp') {
                v = new Date(v).toISOString();
            }
            if (columns[i] == 'ResourceStatus') {
                v = statuses[columns[i]] || v;
            }
            output[i] = v;
        }
        return output;
    };
    return WatchStack;
}());
exports.WatchStack = WatchStack;
