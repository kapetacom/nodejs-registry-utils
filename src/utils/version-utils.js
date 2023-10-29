/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

const _ = require('lodash');
const {parseCommit, validateCommit, applyPlugins, mappers}  = require('parse-commit-message');

exports.parseVersion = function parseVersion(version) {
    let [major, minor, patch] = version.split(/\./g);
    let preRelease = null;
    const preReleaseIx = patch.indexOf('-');
    if (preReleaseIx > -1) {
        preRelease = patch.substring(preReleaseIx + 1);
        patch = patch.substring(0, preReleaseIx);
    }

    return {
        major: parseInt(major),
        minor: parseInt(minor),
        patch: parseInt(patch),
        preRelease,
        /**
         *
         * @param {VersionInfo} other
         */
        compare(other) {
            if (this.major !== other.major) {
                return this.major - other.major;
            }

            if (this.minor !== other.minor) {
                return this.minor - other.minor;
            }

            return this.patch - other.patch;
        },
        toMajorVersion() {
            let out = `${this.major}`;

            if (this.preRelease) {
                out += '-' + this.preRelease;
            }
            return out;
        },
        toMinorVersion() {
            let out = `${this.major}.${this.minor}`;

            if (this.preRelease) {
                out += '-' + this.preRelease;
            }
            return out;
        },
        toFullVersion() {
            let out = `${this.major}.${this.minor}.${this.patch}`;

            if (this.preRelease) {
                out += '-' + this.preRelease;
            }
            return out;
        },
        toString() {
            return this.toFullVersion();
        }
    };
}

/**
 * Get version increment from git logs
 *
 * Calculated from conventional commits:
 * https://www.conventionalcommits.org/en/v1.0.0/
 *
 * @param {string[]} gitLogs
 * @returns {'PATCH'|'MINOR'|'MAJOR'|'NONE'} Version increment - NONE is returned if no commits are found
 */
exports.calculateVersionIncrement = function calculateVersionIncrement(gitLogs) {
    if (!gitLogs || gitLogs.length === 0) {
        return 'NONE';
    }
    const result = gitLogs.map((log) => {
        try {
            return parseCommit(log)
        } catch (e) {
            return null;
        }
    }).filter((commit) => {
        if (!commit) {
            return false;
        }

        return validateCommit(commit, true);
    });
    const commits = applyPlugins([mappers.increment], result);
    let increment = 'patch';
    for (const commit of commits) {
        if (commit.isBreaking) {
            increment = 'major';
            break;
        }

        if (commit.increment === 'minor') {
            increment = 'minor';
        }
    }

    return increment.toUpperCase();
}
