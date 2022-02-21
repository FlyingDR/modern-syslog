// Copyright IBM Corp. 2015,2016. All Rights Reserved.
// Node module: modern-syslog
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

var Writable = require('stream').Writable;
var inherits = require('util').inherits;
var fmt = require('util').format;

// Taken from sys/syslog.h
var constants = {
    LOG_EMERG: 0,
    LOG_ALERT: 1,
    LOG_CRIT: 2,
    LOG_ERR: 3,
    LOG_WARNING: 4,
    LOG_NOTICE: 5,
    LOG_INFO: 6,
    LOG_DEBUG: 7,
    LOG_PRIMASK: 0x07,
    LOG_KERN: (0 << 3),
    LOG_USER: (1 << 3),
    LOG_MAIL: (2 << 3),
    LOG_DAEMON: (3 << 3),
    LOG_AUTH: (4 << 3),
    LOG_SYSLOG: (5 << 3),
    LOG_LPR: (6 << 3),
    LOG_NEWS: (7 << 3),
    LOG_UUCP: (8 << 3),
    LOG_CRON: (9 << 3),
    LOG_AUTHPRIV: (10 << 3),
    LOG_LOCAL0: (16 << 3),
    LOG_LOCAL1: (17 << 3),
    LOG_LOCAL2: (18 << 3),
    LOG_LOCAL3: (19 << 3),
    LOG_LOCAL4: (20 << 3),
    LOG_LOCAL5: (21 << 3),
    LOG_LOCAL6: (22 << 3),
    LOG_LOCAL7: (23 << 3),
    LOG_NFACILITIES: 24,
    LOG_FACMASK: 0x03f8,
    LOG_PID: 0x01,
    LOG_CONS: 0x02,
    LOG_ODELAY: 0x04,
    LOG_NDELAY: 0x08,
    LOG_NOWAIT: 0x10,
    LOG_PERROR: 0x20,
};

var state = {
    ident: '',
    facility: '',
    curmask: constants.LOG_INFO,
}
var core = {
    level: {
        LOG_EMERG: constants.LOG_EMERG,
        LOG_ALERT: constants.LOG_ALERT,
        LOG_CRIT: constants.LOG_CRIT,
        LOG_ERR: constants.LOG_ERR,
        LOG_WARNING: constants.LOG_WARNING,
        LOG_NOTICE: constants.LOG_NOTICE,
        LOG_INFO: constants.LOG_INFO,
        LOG_DEBUG: constants.LOG_DEBUG,
    },
    facility: constants,
    option: constants,

    openlog: (ident, option, facility) => {
        state.ident = ident;
        state.facility = facility;
    },
    syslog: (level, message, cb) => {
        if ((state.curmask & logMask(level)) !== 0) {
            const lname = Object
                .entries(this.level)
                .reduce((r, e) => r ? r : e[1] === level ? e[0].toLowerCase().substring(4) : null, null) || 'info';

            const prefixes = [
                '[syslog]',
            ];
            if (state.ident) {
                prefixes.push(`[i:${state.ident}]`);
            }
            if (state.facility) {
                prefixes.push(`[f:${state.facility.toLowerCase().substring(4)}]`);
            }
            prefixes.push(`[l:${lname}]`);
            console.log(`${prefixes.join('')} ${message}`);
        }

        if (typeof cb === 'function') {
            cb();
        }
    },
    setlogmask: (mask) => {
        if (typeof mask === 'undefined') {
            return 0xff;
        }
        const cm = state.curmask;
        state.curmask = mask;
        return cm;
    },
    closelog: () => null,
};

// Direct access to the core binding
exports.core = core;

// Constants
exports.option = core.option;
exports.facility = core.facility;
exports.level = core.level;

// High-level API, remove the redundant 'log' from method names.
exports.version = require('./package.json').version;
exports.open = open;
exports.init = exports.open;
exports.log = log;
exports.upto = upto;
exports.curmask = curmask;
exports.setMask = setMask;
exports.close = core.closelog;
exports.Stream = Stream;

function open(ident, option, facility) {
    // XXX(sam) would be nice to allow single strings for option
    core.openlog(ident, option, toFacility(facility));
}

function log(level, msg, callback) {
    core.syslog(toLevel(level), msg, callback);
}

function wrap(name, level) {
    level = core.level[level];
    exports[name] = function (msg) {
        core.syslog(level, fmt.apply(null, arguments));
    };
}

wrap('emerg', 'LOG_EMERG');
wrap('alert', 'LOG_ALERT');
wrap('crit', 'LOG_CRIT');
wrap('error', 'LOG_ERR');
wrap('err', 'LOG_ERR');
wrap('warn', 'LOG_WARNING');
wrap('warning', 'LOG_WARNING');
wrap('note', 'LOG_NOTICE');
wrap('notice', 'LOG_NOTICE');
wrap('info', 'LOG_INFO');
wrap('debug', 'LOG_DEBUG');

// Low-level API
exports.setmask = core.setlogmask;
exports.toLevel = toLevel;
exports.toFacility = toFacility;
exports.logMask = logMask;
exports.logUpto = logUpto;

// Invert constants, so its easy to look the string up by the value.
// Expose keys globally, for backwards compatibility with node-syslog.
function expose(obj) {
    for (var key in obj) {
        var val = obj[key];
        exports[key] = val;
        obj[val] = key;
    }
}

expose(exports.option);
expose(exports.facility);
expose(exports.level);

// setlogmask() is too painful to use, most systems have a LOG_UPTO(level)
// macro, we'll just export upto() directly, its what most users will want.
function upto(level) {
    return core.setlogmask(logUpto(level));
}

// Linux allows calling setmask(0) to get the current mask, but OS X does not,
// so make a curmask() to smooth this over.

function curmask() {
    var cur = core.setlogmask(0);
    core.setlogmask(cur);
    return cur;
}

function setMask(level, upto) {
    var mask;

    if (upto) {
        mask = logUpto(level);
    } else {
        mask = logMask(level);
    }

    core.setlogmask(mask);
}

// Writable stream for syslog.

function Stream(level, facility) {
    if (!(this instanceof Stream)) {
        return new Stream(level, facility);
    }

    this.priority = toLevel(level) | toFacility(facility);

    Writable.apply(this);
}

inherits(Stream, Writable);

Stream.prototype._write = function (chunk, encoding, callback) {
    core.syslog(this.priority, chunk, callback);
};

// Low-level API

function toLevel(level) {
    if (typeof level === 'string' && level in core.level) {
        return core.level[level];
    }

    return level;
}

function toFacility(facility) {
    if (typeof facility === 'string' && facility in core.facility) {
        return core.facility[facility];
    }

    return facility;
}

function logMask(level) {
    return 1 << toLevel(level);
}

function logUpto(level) {
    return (1 << (toLevel(level) + 1)) - 1;
}
