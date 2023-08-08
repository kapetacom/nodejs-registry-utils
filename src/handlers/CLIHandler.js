const { spawn } = require('@kapeta/nodejs-process');
const Util = require('util');

const _ = require('lodash');
const blessed = require('blessed');

const OverviewEntry = require('./cli/OverviewEntry.js');

function checkMark(ok) {
    return ok ? '✓' : '✖';
}

/**
 * @type {CLIHandler}
 */
let singleton;

/**
 * @class CLIHandler
 * @implements {ProgressListener}
 */
class CLIHandler {
    static get(interactive) {
        if (!singleton) {
            singleton = new CLIHandler(interactive);
        }
        return singleton;
    }

    constructor(interactive) {
        this.nestingLevel = 0;

        this.interactive = !!interactive;

        this._progress = null;

        this._entries = 0;

        this._sections = 0;
    }

    async run(command, directory) {
        this.info(`Running command "${command}"`);
        const child = spawn(command, {
            cwd: directory ? directory : process.cwd(),
            detached: true,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.onData((data) => {
            this.debug(data.line);
        })

        await child.wait();
    }

    start(title) {
        if (this._screen) {
            return;
        }

        if (!this.interactive) {
            this.info(' !! Non interactive mode enabled !!\n');
            return;
        }

        // Create a screen object.
        this._screen = blessed.screen({
            smartCSR: true,
        });

        this._screen.title = title;

        this._screen.key(['q', 'C-c'], () => {
            process.exit(0);
        });

        // Create a box perfectly centered horizontally and vertically.
        this._overview = blessed.box({
            top: 0,
            left: 0,
            width: '30%',
            bottom: 0,
            content: '',
            tags: true,
            border: {
                type: 'line',
            },
            style: {
                fg: 'white',
                bg: 'magenta',
                border: {
                    fg: '#f0f0f0',
                },
                hover: {
                    bg: 'green',
                },
            },
        });

        this._screen.append(this._overview);

        // Create a box perfectly centered horizontally and vertically.
        this._details = blessed.log({
            top: 0,
            left: '30%',
            right: 0,
            bottom: 0,
            tags: true,
            border: {
                type: 'line',
            },
            keys: true,
            mouse: true,
            alwaysScroll: true,
            scrollable: true,
            scrollbar: {
                style: {
                    bg: 'blue',
                },
            },
            style: {
                focus: {
                    border: {
                        fg: 'blue',
                    },
                },
            },
        });

        this._screen.append(this._details);

        this._details.focus();
    }

    end() {
        if (!this._screen) {
            return;
        }

        this._screen.render();

        const snapshot = this._screen.screenshot();
        this._screen.destroy();
        process.stdout.write(snapshot);
    }

    _startProgress() {
        if (!this._screen) {
            return;
        }

        if (this._progress) {
            throw new Error('Can not start a new progress without existing the previous first');
        }

        this._progress = {
            x: this._screen.x,
            y: this._screen.y,
            iteration: 0,
            interval: setInterval(() => {
                this._updateProgress();
            }, 100),
        };
    }

    _move(x, y) {
        this._screen.move(x, y);
    }

    /**
     *
     * @param message
     * @param {PromiseOrCallback} promise
     * @returns {Promise<*>}
     */
    async progress(message, promise) {
        let out;

        if (this.interactive) {
            const entry = new OverviewEntry({
                top: this._entries++,
            });
            this._overview.append(entry);
            try {
                entry.start(this._getPrefix() + message);

                if (this.nestingLevel > 0) {
                    this.info(this._getPrefix() + message);
                } else {
                    this.section(message);
                }

                this.nestingLevel++;

                if (typeof promise === 'function') {
                    out = await promise();
                } else {
                    out = await promise;
                }
                entry.end(true);
                return out;
            } catch (e) {
                entry.end(false);
                throw e;
            } finally {
                this.nestingLevel--;
            }
            return;
        }

        try {
            this.info(message + ' - START');
            this.nestingLevel++;

            if (promise instanceof Function) {
                out = await promise();
            } else {
                out = await promise;
            }
            this.nestingLevel--;
            this.info(message + ' - OK');
            return out;
        } catch (e) {
            this.nestingLevel--;
            this.info(message + ' - FAILED');
            throw e;
        }
    }

    /**
     *
     * @param {string} message
     * @param {PromiseOrCallback|boolean} ok
     * @returns {Promise<boolean>}
     */
    async check(message, ok) {
        const okType = typeof ok;

        if (this.interactive) {
            const entry = new OverviewEntry({
                top: this._entries++,
            });

            entry.start(this._getPrefix() + message);

            if (okType === 'function') {
                ok = await ok();
            }

            if (ok instanceof Promise) {
                ok = await ok;
            }

            entry.end(ok);
            if (ok) {
                this.info(this._getPrefix() + message + ' - OK');
            } else {
                this.warn(this._getPrefix() + message + ' - FAILED');
            }

            this._overview.append(entry);
            return ok;
        }

        if (okType === 'function') {
            ok = await ok();
        }

        if (ok instanceof Promise) {
            ok = await ok;
        }

        this._log('INFO', ['%s: %s', message, checkMark(ok)]);

        return ok;
    }

    /**
     *
     * @param {string} message
     * @param {string} value
     */
    showValue(message, value) {
        if (this.interactive) {
            const entry = new OverviewEntry({
                top: this._entries++,
            });

            entry.start(this._getPrefix() + message + ': {bold}' + value + '{/}');
            entry.end(true);

            this._overview.append(entry);
            return;
        }

        this._log('INFO', ['%s: %s', message, value]);
    }

    info(message) {
        this._log('INFO', arguments);
    }

    warn(message) {
        this._log('WARN', arguments);
    }

    debug(message) {
        this._log('DEBUG', arguments);
    }

    error(message) {
        this._log('ERROR', arguments);
    }

    section(title) {
        this.info('\n');
        this.info('------------------------------------------');
        this.info(' ' + ++this._sections + '. ' + title);
        this.info('------------------------------------------');
        this.info('\n');
    }

    _log(level, parentArguments) {
        const args = _.toArray(parentArguments);
        const message = args.shift();

        let prefix = '';
        let postfix = '';
        if (this.interactive) {
            postfix = '{/}';
            switch (level) {
                case 'WARN':
                    prefix = '{yellow-fg}';
                    break;
                case 'ERROR':
                    prefix = '{red-fg}';
                    break;
                case 'INFO':
                    break;
                case 'DEBUG':
                    prefix = '{blue-fg}';
                    break;
            }
        } else {
            prefix = this._getPrefix();
        }

        this._println(prefix + Util.format(message, ...args) + postfix);
    }

    _println(text) {
        if (this.interactive) {
            this._details.add(text);
        } else {
            process.stdout.write(text + '\n');
        }
    }

    _getPrefix() {
        let prefix = '';
        for (let i = 0; i < this.nestingLevel; i++) {
            if (this.interactive) {
                prefix += ' ‣ ';
            } else {
                prefix += ' - ';
            }
        }

        return prefix;
    }
}

module.exports = CLIHandler;
