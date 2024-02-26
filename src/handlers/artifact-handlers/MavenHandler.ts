import FS from 'node:fs';
import URL from 'node:url';
import Path from 'node:path';
import os from 'node:os';
import FSExtra from 'fs-extra';
import XmlJS from 'xml-js';
import Config from '../../config';
import { hashElement } from 'folder-hash';
import { ArtifactHandler, MavenDetails, ProgressListener } from '../../types';

const MAVEN_SERVER_ID: string = 'kapeta';

export class MavenHandler implements ArtifactHandler<MavenDetails> {
    static getType(): string {
        return 'maven';
    }

    static isSupported(directory: string): boolean {
        return FS.existsSync(Path.join(directory, 'pom.xml'));
    }

    static create(progressListener: ProgressListener, directory: string): MavenHandler {
        return new MavenHandler(progressListener, directory);
    }

    static generateSettings(): any {
        return XmlJS.xml2js(`<?xml version="1.0" encoding="UTF-8"?>
                <settings   
                    xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.1.0 http://maven.apache.org/xsd/settings-1.1.0.xsd" 
                    xmlns="http://maven.apache.org/SETTINGS/1.1.0"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
                </settings>
        `);
    }

    static generateServer(token: string): any {
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

    private _progressListener: ProgressListener;
    private _directory: string;
    private _hostInfo: URL.UrlWithStringQuery;
    private _configFile: string | null;
    private _accessToken: string | undefined;

    constructor(progressListener: ProgressListener, directory: string, accessToken?: string) {
        this._progressListener = progressListener;
        this._directory = directory;
        this._hostInfo = URL.parse(Config.data.registry.maven);
        this._configFile = null;
        this._accessToken = accessToken;
        this._ensureConfig();
    }

    private _ensureConfig(): void {
        this._configFile = `${os.homedir()}/.m2/settings.xml`;
        let config: any;
        if (FS.existsSync(this._configFile)) {
            config = XmlJS.xml2js(FS.readFileSync(this._configFile).toString());
            this._progressListener.info(`Ensuring maven server configuration in ${this._configFile}`);
        } else {
            this._configFile = `${os.tmpdir()}/maven-settings.xml`;
            this._progressListener.info(`Writing temporary maven settings file to ${this._configFile}`);
            config = MavenHandler.generateSettings();
        }

        let servers = config.elements[0].elements.find((e: any) => e.name === 'servers');
        if (!servers) {
            servers = XmlJS.xml2js('<servers></servers>').elements[0];
            config.elements[0].elements.push(servers);
        }

        let kapetaServer = servers.elements.find((server: any) => {
            return server.elements.find((el: any) => el.name === 'id').elements[0].text === MAVEN_SERVER_ID;
        });

        const newServer = MavenHandler.generateServer(this._accessToken ? `Bearer ${this._accessToken}` : 'anonymous');

        if (kapetaServer) {
            kapetaServer.elements = newServer.elements;
        } else {
            kapetaServer = newServer;
            servers.elements.push(kapetaServer);
        }

        const newSettings = XmlJS.js2xml(config, { spaces: 4 });

        FS.writeFileSync(this._configFile, newSettings);
    }

    getName(): string {
        return 'Maven';
    }

    async verify(): Promise<void> {
        const cmd = process.platform === 'win32' ? 'where mvn' : 'which mvn';
        return await this._progressListener.progress('Checking if MVN is available', () =>
            this._progressListener.run(cmd, this._directory),
        );
    }

    async calculateChecksum(): Promise<string> {
        const result = await hashElement(Path.join(this._directory, 'target'), {
            folders: {
                exclude: ['*'],
                matchPath: false,
                ignoreBasename: true,
                ignoreRootName: true,
            },
            files: {
                include: ['*.jar'],
            },
        });

        if (result.children && result.children.length > 0) {
            return result.children[0].hash;
        }

        return result.hash;
    }

    private _writePOM(pomRaw: string): void {
        FS.writeFileSync(Path.join(this._directory, 'pom.xml'), pomRaw);
    }

    private _makePOMBackup(): void {
        const backupFile = Path.join(this._directory, 'pom.xml.original');
        if (FS.existsSync(backupFile)) {
            FS.unlinkSync(backupFile);
        }
        FS.copyFileSync(Path.join(this._directory, 'pom.xml'), backupFile);
    }

    private _restorePOMBackup(): void {
        const backupFile = Path.join(this._directory, 'pom.xml.original');
        if (FS.existsSync(backupFile)) {
            FS.unlinkSync(Path.join(this._directory, 'pom.xml'));
            FS.renameSync(backupFile, Path.join(this._directory, 'pom.xml'));
        }
    }

    async push(name: string, version: string, commit: string): Promise<{ type: string; details: MavenDetails }> {
        const command = `mvn --settings "${this._configFile}" deploy -B -DskipTests=1 -DaltDeploymentRepository=${MAVEN_SERVER_ID}::default::${this._hostInfo.href}`;

        const [groupId, artifactId] = name.split(/\//);

        this._makePOMBackup();

        const pomRaw = FS.readFileSync(Path.join(this._directory, 'pom.xml')).toString();

        const pom = XmlJS.xml2js(pomRaw);

        const project = pom.elements[0];

        const setValue = (name: string, value: string): void => {
            project.elements.find((e: any) => e.name === name).elements[0].text = value;
        };

        setValue('groupId', groupId);
        setValue('artifactId', artifactId);
        setValue('version', version);

        const newPom = XmlJS.js2xml(pom, { spaces: 4 });

        this._writePOM(newPom);

        try {
            await this._progressListener.progress(`Deploying maven package: ${groupId}:${artifactId}[${version}]`, () =>
                this._progressListener.run(command, this._directory),
            );
        } finally {
            this._restorePOMBackup();
        }

        return {
            type: MavenHandler.getType(),
            details: {
                groupId,
                artifactId,
                version,
                registry: this._hostInfo.href,
            },
        };
    }

    async pull(details: MavenDetails, target: string): Promise<void> {
        const artifact = `${details.groupId}:${details.artifactId}:${details.version}`;
        const repo = `${MAVEN_SERVER_ID}::default::${details.registry}`;
        const dependencyGetCmd = `mvn -U --settings "${this._configFile}" dependency:get -B -Ddest=${target} -Dartifact=${artifact} -DremoteRepositories=${repo}`;
        await this._progressListener.progress('Pulling maven package', () =>
            this._progressListener.run(dependencyGetCmd, this._directory),
        );
    }

    async install(sourcePath: string, targetPath: string): Promise<void> {
        FSExtra.moveSync(sourcePath, targetPath, { overwrite: true });
    }

    async build(): Promise<void> {
        return this._progressListener.progress('Building maven package', () =>
            this._progressListener.run('mvn -U clean package -B', this._directory),
        );
    }

    async test(): Promise<void> {
        return this._progressListener.progress('Testing maven package', () =>
            this._progressListener.run('mvn -U test -B', this._directory),
        );
    }
}
