/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import { parseVersion } from '@kapeta/nodejs-utils';
import CommitParser from 'conventional-commits-parser';

interface Commit {
    type: string;
    scope: string;
    subject: string;
    notes: string[];
}

const CommitParserOptions = {
    headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
    breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
    headerCorrespondence: ['type', 'scope', 'subject'],
    noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
    revertPattern: /^(?:Revert|revert:)\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i,
    revertCorrespondence: ['header', 'hash'],
    issuePrefixes: ['#'],
};

export function versionFormatter(version: string) {
    const v = parseVersion(version);

    function maybeAppendPreRelease(out: string) {
        if (v.preRelease) {
            out += '-' + v.preRelease;
            if (v.preReleaseIteration) {
                out += '.' + v.preReleaseIteration;
            }
        }

        if (v.build) {
            out += '+' + v.build;
            if (v.buildIteration) {
                out += '.' + v.buildIteration;
            }
        }
        return out;
    }

    return {
        version: v,
        toMajorVersion() {
            return maybeAppendPreRelease(`${v.major}`);
        },
        toMinorVersion() {
            return maybeAppendPreRelease(`${v.major}.${v.minor}`);
        },
        toFullVersion() {
            return maybeAppendPreRelease(`${v.major}.${v.minor}.${v.patch}`);
        },
        toString() {
            return this.toFullVersion();
        },
    };
}

export function calculateVersionIncrement(gitLogs: string[]): 'PATCH' | 'MINOR' | 'MAJOR' | 'NONE' {
    if (!gitLogs || gitLogs.length === 0) {
        return 'NONE';
    }
    const commits = gitLogs
        .map((log) => {
            try {
                return CommitParser.sync(log, CommitParserOptions);
            } catch (e) {
                console.log('Failed to parse commit: ', e);
                return null;
            }
        })
        .filter((commit) => {
            return commit?.type;
        });

    let increment = 0;
    for (const commit of commits) {
        if (!commit?.type) {
            continue;
        }
        switch (commit.type?.toLowerCase()) {
            case 'feat':
                if (increment < 2) {
                    increment = 2;
                }
                break;
            case 'fix':
                if (increment < 1) {
                    increment = 1;
                }
                break;
        }

        const isBreaking =
            commit.notes &&
            commit.notes.length > 0 &&
            commit.notes.some((note) => CommitParserOptions.noteKeywords.includes(note.title.toUpperCase()));

        if (isBreaking) {
            increment = 3;
            break;
        }
    }

    switch (increment) {
        case 3:
            return 'MAJOR';
        case 2:
            return 'MINOR';
        case 1:
            return 'PATCH';
    }

    return 'PATCH';
}
