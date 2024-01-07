/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

const FS = require('node:fs');
const Path = require('node:path');
const URL = require('node:url');
const DockerService = require("../../services/DockerService");
const {versionFormatter} = require("../../utils/version-utils");
const FSExtra = require("fs-extra");
const Config = require("../../config");

/**
 * @class
 * @implements {ArtifactHandler}
 */
class DockerHandler {
    /**
     *
     * @param {ProgressListener} progressListener
     * @param {string} directory
     * @param {string} accessToken
     */
    constructor(progressListener, directory, accessToken) {
        this._progressListener = progressListener;
        this._directory = directory;
        this._hostInfo = URL.parse(Config.data.registry.docker);
        this._dockerService = new DockerService(this._progressListener, this._hostInfo, accessToken);
    }


    static getType() {
        return "docker";
    }

    /**
     *
     * @param dirname
     * @returns {Promise<boolean>}
     */
    static async isSupported(dirname) {
        return FS.existsSync(Path.join(dirname,'Dockerfile'));
    }

    static create(progressListener, directory, accessToken) {
        return new DockerHandler(progressListener, directory, accessToken);
    }

    getName() {
        return "Docker";
    }


    async verify() {
        return this._dockerService.verify();
    }

    /**
     *
     * @returns {Promise<string>} calculates checksum of image content
     */
    async calculateChecksum() {
        return this._progressListener.progress(`Calculating checksum`, async () => {
            const checksum = await this._dockerService.calculateChecksum(this._directory);
            this._progressListener.info(`Checksum: ${checksum}`);
            return checksum;
        });
    }

    /**
     *
     * @param {string} name
     * @param {string} version
     * @param {string|undefined} [commitId]
     * @returns {Promise<Artifact<DockerDetails>>}
     */
    async push( name, version, commitId) {
        const dockerTags = this._getDockerTags(name, version, commitId);

        await this._progressListener.progress(`Building docker image for ${name}:${version}`, async () => this.buildDockerImage(name, dockerTags));

        return {
            type: DockerHandler.getType(),
            details: {
                name: this._getDockerImageName(name),
                primary: this._getPrimaryDockerImage(name, version),
                tags: dockerTags
            }
        };
    }

    /**
     *
     * @param {string} name
     * @param {string} version
     * @param {string} [commitId]
     * @returns {string[]}
     * @private
     */
    _getDockerTags(name, version, commitId) {
        const dockerImage = this._getDockerImageName(name);

        const tags = this._getVersionTags(version, dockerImage + ':');
        if (commitId) {
            tags.push(`${dockerImage}:${commitId}`);
        }

        return tags;
    }

    /**
     *
     * @param {string} version
     * @param {string} [prefix='']
     * @returns {string[]}
     * @private
     */
    _getVersionTags(version, prefix) {
        if (!prefix) {
            prefix = '';
        }

        const versionInfo = versionFormatter(version);
0
        return [
            `${prefix}${versionInfo.toFullVersion()}`,
            `${prefix}${versionInfo.toMinorVersion()}`,
            `${prefix}${versionInfo.toMajorVersion()}`
        ];
    }

    /**
     *
     * @param {string} name
     * @param {string} version
     * @returns {string}
     * @private
     */
    _getPrimaryDockerImage(name, version) {
        const dockerImage = this._getDockerImageName(name);

        return `${dockerImage}:${version}`;
    }

    /**
     *
     * @param {string} name
     * @param {string[]} tags
     * @returns {Promise<string[]>} returns all tags for image
     */
    async tagDockerImage(name, tags) {
        this._progressListener.info('Tagging docker images', tags);

        await this._dockerService.tag(this._getLocalBuildName(name), tags);
    }


    /**
     *
     * @param {string} name
     * @param {string[]} tags
     * @returns {Promise<string>} returns image name
     */
    async buildDockerImage(name, tags) {
        const dockerImageName = this._getLocalBuildName(name);
        await this._progressListener.progress(`Building local docker image: ${dockerImageName}`, async () => {
            return this._dockerService.build(this._directory, tags);
        });

        return dockerImageName
    }

    /**
     *
     * @param {string} name
     * @returns {string}
     * @private
     */
    _getDockerImageName(name) {
        if (this._hostInfo) {
            return `${this._hostInfo.host}/${name}`.toLowerCase();
        }
        return `${name}`.toLowerCase();
    }

    /**
     *
     * @param {string} name
     * @returns {string}
     * @private
     */
    _getLocalBuildName(name) {
        return `${name}:local`.toLowerCase();
    }


    /**
     *
     * @param {DockerDetails} details
     * @param {string} target
     * @param {RegistryService} registryService
     * @returns {Promise<void>}
     */
    async pull(details, target, registryService) {
        await this._progressListener.progress(`Pulling docker image: ${details.primary}`, async () => {
            await this._dockerService.pull(details.primary);
        });

        //We just put this here to actually put something on disk
        //Currently unused
        FSExtra.mkdirpSync(target);
        FS.writeFileSync(Path.join(target, 'docker-info.json'), JSON.stringify(details, null, 2));
    }

    async install(sourcePath, targetPath) {
        FSExtra.moveSync(sourcePath, targetPath, {recursive: true, overwrite: true});
    }

    async build() {
        //Meant as a pre-test thing - Not applicable
    }

    async test() {
        //Meant as a pre-deploy thing - Not applicable
    }
}

/**
 *
 * @type {ArtifactHandlerFactory}
 *
 */
module.exports = DockerHandler;