AWS Stack Watch
===============

A command line tool to monitor an AWS CloudFormation stack during updates, breakpoints as soon as a rollback starts.

To Do
-----

- [ ] get a screenshot for this readme
- [ ] visual notification when monitoring is paused
- [ ] fill in the gaps between when a stack is paused and when it catches back up in case there are missed events
- [ ] figure out how to get color formatting into the blessed-contrib table for resource statuses
- [ ] include hot keys in help message

Install
-------

    npm install -g aws-stack-watch

Usage
-----

    Watch a CloudFormation stack update. Press q to quit.
    Usage: aws-stack-watch

    Options:
    --version          Show version number                               [boolean]
    -H, --help         Print usage and quit.                             [boolean]
    -s, --stackName    CloudFormation Stack Name                        [required]
    -w, --waitSeconds  Number of seconds to wait between polls        [default: 5]
    -r, --region       AWS Region that contains the stack   [default: "us-east-1"]

Hot keys
--------

* p: pause / resume
* q/ctrl-c: quit
* return: inspect the selected event
* esc: close the details window