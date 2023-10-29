/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

const FS = require('node:fs');
const URL = require("node:url");
const Path = require('node:path');
const XmlJS = require('xml-js');
const Config = require("../../config");
const { hashElement } = require('folder-hash');
const os = require("os");
const FSExtra = require("fs-extra");
const {KapetaAPI} = require("@kapeta/nodejs-api-client");

const MAVEN_SERVER_ID = 'kapeta';
/**
 * @class
 * @implements {ArtifactHandler<MavenDetails>}
 */
class MavenHandler {
    static getType() {
        return "maven";
    }

    static isSupported(directory) {
        return FS.existsSync(Path.join(directory,'pom.xml'));
    }

    static create(progressListener, directory) {
        return new MavenHandler(progressListener, directory);
    }

    static generateSettings() {
        return XmlJS.xml2js(`<?xml version="1.0" encoding="UTF-8"?>
                <settings   
                    xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.1.0 http://maven.apache.org/xsd/settings-1.1.0.xsd" 
                    xmlns="http://maven.apache.org/SETTINGS/1.1.0"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
                </settings>
        `);
    }

    static generateServer(token) {
        return XmlJS.xml2js(`
            <server>
                <id>${MAVEN_SERVER_ID}</id>
                <configuration>
                    <httpHeaders>
                        <property>
                            <name>Authorization</name>
                            <value>${token}</value>
                        </property>
                    </httpHeaders>
                </configuration>
            </server>
        `).elements[0];
    }

    /**
     *
     * @param {ProgressListener} progressListener
     * @param {string} directory
     * @param {string} accessToken
     */
    constructor(progressListener, directory, accessToken) {
        this._progressListener = progressListener;
        this._directory = directory;
        this._hostInfo = URL.parse(Config.data.registry.maven);
        this._configFile = null;
        this._accessToken = accessToken;
        this._ensureConfig();
    }

    _ensureConfig() {
        this._configFile = `${os.homedir()}/.m2/settings.xml`;
        let config;
        if (FS.existsSync(this._configFile)) {
            config = XmlJS.xml2js(FS.readFileSync(this._configFile).toString());
            this._progressListener.info(`Ensuring maven server configuration in ${this._configFile}`);
        } else {
            this._configFile = `${os.tmpdir()}/maven-settings.xml`;
            this._progressListener.info(`Writing temporary maven settings file to ${this._configFile}`);
            config = MavenHandler.generateSettings();
        }

        let servers = config.elements[0].elements.find(e => e.name === 'servers');
        if (!servers) {
            servers = XmlJS.xml2js('<servers></servers>').elements[0];
            config.elements[0].elements.push(servers);
        }

        let kapetaServer = servers.elements.find(server => {
            return server.elements.find(el => el.name === 'id').elements[0].text === MAVEN_SERVER_ID;
        });

        const newServer = MavenHandler.generateServer(this._accessToken ?
            `Bearer ${this._accessToken}`
            : 'anonymous');

        if (kapetaServer) {
            kapetaServer.elements = newServer.elements;
        } else  {
            kapetaServer = newServer;
            servers.elements.push(kapetaServer);
        }

        const newSettings = XmlJS.js2xml(config, {spaces: 4});

        FS.writeFileSync(this._configFile, newSettings);
    }


    getName() {
        return "Maven";
    }

    async verify() {
        const cmd = (process.platform === 'win32') ? 'where mvn' : 'which mvn';
        return await this._progressListener.progress('Checking if MVN is available',
            () => this._progressListener.run(cmd, this._directory)
        );
    }

    async calculateChecksum() {
        const result = await hashElement(Path.join(this._directory,'target'), {
            folders: {
                exclude: ['*'],
                matchPath: false,
                ignoreBasename: true,
                ignoreRootName: true
            },
            files: {
                include: ['*.jar']
            }
        });

        if (result.children && result.children.length > 0) {
            return result.children[0].hash
        }

        return result.hash;
    }

    _writePOM(pomRaw) {
        FS.writeFileSync(Path.join(this._directory, 'pom.xml'), pomRaw);
    }

    _makePOMBackup() {
        const backupFile = Path.join(this._directory, 'pom.xml.original');
        if (FS.existsSync(backupFile)) {
            FS.unlinkSync(backupFile);
        }
        FS.copyFileSync(Path.join(this._directory, 'pom.xml'), backupFile);
    }

    _restorePOMBackup() {
        const backupFile = Path.join(this._directory, 'pom.xml.original');
        if (FS.existsSync(backupFile)) {
            FS.unlinkSync(Path.join(this._directory, 'pom.xml'));
            FS.renameSync(backupFile, Path.join(this._directory, 'pom.xml'));
        }
    }

    async push(name, version, commit) {
        const command = `mvn --settings "${this._configFile}" deploy -B -DskipTests=1 -DaltDeploymentRepository=${MAVEN_SERVER_ID}::default::${this._hostInfo.href}`;

        const [groupId, artifactId] = name.split(/\//);

        this._makePOMBackup();

        const pomRaw = FS.readFileSync(Path.join(this._directory, 'pom.xml')).toString();

        const pom = XmlJS.xml2js(pomRaw);

        const project = pom.elements[0];

        const setValue = (name, value) => {
            project.elements.find(e => e.name === name).elements[0].text = value;
        };

        setValue('groupId', groupId);
        setValue('artifactId', artifactId);
        setValue('version', version);

        const newPom = XmlJS.js2xml(pom, {spaces: 4});

        this._writePOM(newPom);

        try {

            await this._progressListener.progress(`Deploying maven package: ${groupId}:${artifactId}[${version}]`,
                () => this._progressListener.run(command, this._directory));
        } finally {
            this._restorePOMBackup();
        }

        return {
            type: MavenHandler.getType(),
            details: {
                groupId,
                artifactId,
                version,
                registry: this._hostInfo.href
            }
        }
    }

    /**
     *
     * @param {MavenDetails} details
     * @param {string} target
     * @returns {Promise<never>}
     */
    async pull(details, target) {
        const artifact = `${details.groupId}:${details.artifactId}:${details.version}`;
        const repo = `${MAVEN_SERVER_ID}::default::${details.registry}`;
        const dependencyGetCmd = `mvn -U --settings "${this._configFile}" dependency:get -B -Ddest=${target} -Dartifact=${artifact} -DremoteRepositories=${repo}`;
        await this._progressListener.progress('Pulling maven package', () => this._progressListener.run(dependencyGetCmd, this._directory));
    }

    async install(sourcePath, targetPath) {
        FSExtra.moveSync(sourcePath, targetPath, {recursive: true, overwrite: true});
    }

    async build() {
        return this._progressListener.progress('Building maven package', () => this._progressListener.run('mvn -U clean package -B', this._directory));
    }

    async test() {
        return this._progressListener.progress('Testing maven package', () => this._progressListener.run('mvn -U test -B', this._directory));
    }
}

module.exports = MavenHandler
