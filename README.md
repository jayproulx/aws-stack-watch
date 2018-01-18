AWS Stack Watch
===============

A command line tool to monitor an AWS CloudFormation stack during updates, breakpoints as soon as a rollback starts

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