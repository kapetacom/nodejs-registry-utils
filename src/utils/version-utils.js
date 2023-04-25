const _ = require('lodash');

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