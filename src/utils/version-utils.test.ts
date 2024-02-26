/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import { versionFormatter, calculateVersionIncrement } from './version-utils';

describe('versionFormatter', () => {
    test('can format normal version', () => {
        const formatter = versionFormatter('1.2.3');
        expect(formatter.toMajorVersion()).toBe('1');
        expect(formatter.toMinorVersion()).toBe('1.2');
        expect(formatter.toFullVersion()).toBe('1.2.3');
        expect(formatter.toString()).toBe('1.2.3');
    });

    test('can format pre-release version', () => {
        const formatter = versionFormatter('1.2.3-beta.1');
        expect(formatter.toMajorVersion()).toBe('1-beta.1');
        expect(formatter.toMinorVersion()).toBe('1.2-beta.1');
        expect(formatter.toFullVersion()).toBe('1.2.3-beta.1');
        expect(formatter.toString()).toBe('1.2.3-beta.1');
    });

    test('can format build version', () => {
        const formatter = versionFormatter('1.2.3+1234');
        expect(formatter.toMajorVersion()).toBe('1+1234');
        expect(formatter.toMinorVersion()).toBe('1.2+1234');
        expect(formatter.toFullVersion()).toBe('1.2.3+1234');
        expect(formatter.toString()).toBe('1.2.3+1234');
    });

    test('can format pre-release build version', () => {
        const formatter = versionFormatter('1.2.3-alpha.1+test.34');
        expect(formatter.toMajorVersion()).toBe('1-alpha.1+test.34');
        expect(formatter.toMinorVersion()).toBe('1.2-alpha.1+test.34');
        expect(formatter.toFullVersion()).toBe('1.2.3-alpha.1+test.34');
        expect(formatter.toString()).toBe('1.2.3-alpha.1+test.34');
    });
});

describe('calculateVersionIncrement', () => {
    test('defaults to patch increment', () => {
        expect(calculateVersionIncrement(['Not conventional'])).toBe('PATCH');
    });

    test('can calculate patch increment', () => {
        expect(calculateVersionIncrement(['fix: Do something'])).toBe('PATCH');
    });

    test('can calculate minor increment', () => {
        expect(calculateVersionIncrement(['feat: Do something'])).toBe('MINOR');
    });

    test('can calculate major increment with header', () => {
        expect(calculateVersionIncrement(['feat!: Broke something'])).toBe('MAJOR');
    });

    test('can calculate major increment from notes', () => {
        expect(calculateVersionIncrement(['feat: Broke something here\nBREAKING CHANGE: Broke it'])).toBe('MAJOR');
    });

    test('can calculate major increment from notes', () => {
        expect(calculateVersionIncrement(['feat: Broke something here\nBREAKING-CHANGE: Broke it'])).toBe('MAJOR');
    });

    test('for multiple commits highest wins', () => {
        expect(calculateVersionIncrement(['fix: Do something', 'feat: Do something', 'chore: Do something'])).toBe(
            'MINOR',
        );

        expect(
            calculateVersionIncrement([
                'fix: Do something',
                'feat: Do something',
                'chore: Do something',
                'feat!: Break something',
            ]),
        ).toBe('MAJOR');
    });
});
