#!/usr/bin/env ts-node

import * as AWS from "aws-sdk";
const winston = require('winston');
const util = require('util');
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const colors = require('colors');

const logger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

let columns = [
    // 'PhysicalResourceId',
    'LogicalResourceId',
    'ResourceType',
    'ResourceStatus',
    'Timestamp'
];

let termWidth = process.stdout.columns || 255;

let columnWidths = [
    Math.floor(termWidth * 0.4),
    Math.floor(termWidth * 0.2),
    Math.floor(termWidth * 0.2),
    Math.floor(termWidth * 0.2),
];

let statuses:any = {
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


export class WatchStack {
    private options: any;
    private events: any[];
    private tabularEvents: any[];
    private table: any;
    private modal: any;
    private screen: any;
    private cloudformation: AWS.CloudFormation;
    private pause: boolean;
    private scanIndex = 0;
    private latestEventTime = 0;
    private nextTimeout;

    // this is the same as a describeStackEvents response, but without any events that have already been processed
    private queue: any;

    constructor(options) {
        this.options = options;

        this.options.waitSeconds = this.options.waitSeconds || 5;
        this.options.region = this.options.region || "us-east-1";

        if(!this.options.stackName) {
            throw new Error("You must provide a valid stack name. i.e. { stackName: 'us-east-1' }");
        }
        
        logger.info(`Watching ${this.options.stackName} in ${this.options.region} every ${this.options.waitSeconds} seconds.`);

        this.cloudformation = new AWS.CloudFormation({apiVersion: '2010-05-15', region: options.region});

        this.initialize();
    }

    startPolling() {
        this.poll();
    }

    poll() {
        let self = this;
        
        if(this.pause) {
            return;
        }

        this.setLabel(`Polling`);
        logger.debug("Polling");

        try {
            this.cloudformation.describeStackEvents({StackName: this.options.stackName}, (err, data) => {
                this.setLabel("");

                if (err) {
                    logger.error(err, err.stack);
                    process.exit(1);
                }
                else {
                    self.scanEvents(data as any);
    
                    this.nextTimeout = setTimeout(this.poll.bind(this), this.options.waitSeconds * 1000);
                }
            });
        } catch(error) {
            console.error("Error while connecting to cloudFormation.");
            console.error(error);
            logger.error(error);

            process.exit(1);
        }
    }

    setLabel(label:string) {
        if(!this.table) return;

        if(label && label.length) {
            label = ` (${label})`;
        }

        this.table.setLabel(`${this.options.stackName} ${label}`);
        this.screen.render();
    }

    initialize() {
        let self = this;

        this.screen = blessed.screen();
        this.events = [];
        this.tabularEvents = [];

        this.table = contrib.table(
            {
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
            }
        );

        this.screen.key(['q', 'C-c'], function (ch: any, key: any) {
            return process.exit(0);
        });

        this.screen.key(['p'], function (ch: any, key: any) {
            if(self.pause) {
                self.resumeScanning();
            } else {
                self.pauseScanning();
            }
        });

        this.table.focus();
        this.screen.append(this.table);

        this.table.setData(
            {
                headers: columns,
                data: []
            }
        );

        this.screen.render();

        this.screen.key(['escape'], function (ch: any, key: any) {
            if (self.modal) {
                self.modal.destroy();
                self.modal = null;
            }

            self.screen.render();
        });

        this.table.rows.on('select', (arg1: any, index: any, arg3: any) => {
            // self.screen.destroy();

            if (self.modal) {
                self.modal.destroy();
            }

            let selected = self.events[index];

            try {
                selected.ResourceProperties = JSON.parse(selected.ResourceProperties);
            } catch (e) {
            }

            let formatted = util.inspect(selected, {
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
    }

    scanEvents(events: any) {
        if(events == null) return;

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
    }

    updateEvents(events: any) {
        this.queue = events;

        logger.debug(`Updating events, latest event time is ${this.latestEventTime}`);

        while(this.queue.StackEvents.length) {
            let event = this.queue.StackEvents.shift();

            // discard events older than the newest processed event
            if(new Date(event.Timestamp).getTime() < this.latestEventTime) {
                logger.debug(`Ignoring event because timestamp is ${new Date(event.Timestamp).getTime()}`);
                // continue;
            }

            this.addOrUpdateEvent(event);

            // someone paused, don't keep looping, save the queue for the unpause
            if(this.pause) {
                return;
            }

            if(this.scanIndex > 0 && event.ResourceType == "AWS::CloudFormation::Stack" && event.ResourceStatus == "UPDATE_ROLLBACK_IN_PROGRESS") {
                this.pauseScanning();
                return;
            }
        }
    }

    pauseScanning() {
        this.setLabel("Paused");
        this.pause = true;
        clearTimeout(this.nextTimeout);
    }

    resumeScanning() {
        this.pause = false;
        let queue = this.queue;
        this.queue = null;
        this.scanEvents(queue);
        this.startPolling();
    }

    addOrUpdateEvent(resource: any) {
        let updated = false;
        let added = false;

        let id = 'LogicalResourceId';

        for (let i = 0; i < this.events.length; i++) {
            let currentEvent = this.events[i];
            if (currentEvent[id] == resource[id]) {
                this.events[i] = resource;

                updated = true;
            }
        }

        if (!updated) {
            this.events.push(resource);

            added = true;
        }

        if(updated || added) {
            let ts = new Date(resource.Timestamp).getTime();

            if(ts > this.latestEventTime) {
                this.latestEventTime = ts;
            }
        }
    }

    updateTabularEvents() {
        this.tabularEvents = [];

        for (let i = 0; i < this.events.length; i++) {
            let tabularResource = this.eventToArray(this.events[i]);

            this.tabularEvents.push(tabularResource);
        }
    }

    sortStackEventsByTime(s1: any, s2: any) {
        if (s1.Timestamp < s2.Timestamp) {
            return -1;
        }

        if (s1.Timestamp > s2.Timestamp) {
            return 1;
        }

        return 0;
    }

    sortStackEventsByTimeDesc(s1: any, s2: any) {
        if (s1.Timestamp < s2.Timestamp) {
            return 1;
        }

        if (s1.Timestamp > s2.Timestamp) {
            return -1;
        }

        return 0;
    }

    sortByLogicalResourceId(s1: any, s2: any) {
        let id = 'LogicalResourceId';

        let uuid1 = s1[id].toUpperCase();
        let uuid2 = s2[id].toUpperCase();

        if (uuid1 < uuid2) {
            return -1;
        }
        if (uuid1 > uuid2) {
            return 1;
        }

        // names must be equal
        return 0;
    }

    eventToArray(resource: any) {
        if (!resource) return [];

        let output = [];

        for (let i = 0; i < columns.length; i++) {
            let v = resource[columns[i]];

            if (columns[i] == 'Timestamp') {
                v = new Date(v).toISOString();
            }

            if (columns[i] == 'ResourceStatus') {
                v = statuses[columns[i]] || v;
            }

            output[i] = v;
        }

        return output;
    }
}