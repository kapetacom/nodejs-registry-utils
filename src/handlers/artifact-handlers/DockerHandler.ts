import Config from '../../config';
import FSExtra from 'fs-extra';
import URL from 'url';
import Path from 'path';
import FS from 'fs';
import { DockerService } from '../../services/DockerService';
import { versionFormatter } from '../../utils/version-utils';
import { ArtifactHandler, ProgressListener } from '../../types';
import { UrlWithStringQuery } from 'node:url';
import { RegistryService } from '../../services/RegistryService';

interface DockerDetails {
    name: string;
    primary: string;
    tags: string[];
}

interface Artifact<T> {
    type: string;
    details: T;
}

export class DockerHandler implements ArtifactHandler {
    private _progressListener: ProgressListener;
    private _directory: string;
    private _hostInfo: UrlWithStringQuery;
    private _dockerService: DockerService;

    constructor(progressListener: ProgressListener, directory: string, accessToken: string) {
        this._progressListener = progressListener;
        this._directory = directory;
        this._hostInfo = URL.parse(Config.data.registry.docker);
        this._dockerService = new DockerService(this._progressListener, this._hostInfo, accessToken);
    }

    static getType(): string {
        return 'docker';
    }

    static async isSupported(dirname: string): Promise<boolean> {
        return FS.existsSync(Path.join(dirname, 'Dockerfile'));
    }

    static create(progressListener: ProgressListener, directory: string, accessToken: string): DockerHandler {
        return new DockerHandler(progressListener, directory, accessToken);
    }

    getName(): string {
        return 'Docker';
    }

    async verify(): Promise<void> {
        return this._dockerService.verify();
    }

    async calculateChecksum(): Promise<string> {
        return this._progressListener.progress(`Calculating checksum`, async () => {
            const checksum = await this._dockerService.calculateChecksum(this._directory);
            this._progressListener.info(`Checksum: ${checksum}`);
            return checksum;
        });
    }

    async push(name: string, version: string, commitId?: string): Promise<Artifact<DockerDetails>> {
        const dockerTags = this._getDockerTags(name, version, commitId);

        await this._progressListener.progress(`Building docker image for ${name}:${version}`, async () =>
            this.buildDockerImage(name, dockerTags),
        );

        return {
            type: DockerHandler.getType(),
            details: {
                name: this._getDockerImageName(name),
                primary: this._getPrimaryDockerImage(name, version),
                tags: dockerTags,
            },
        };
    }

    private _getDockerTags(name: string, version: string, commitId?: string): string[] {
        const dockerImage = this._getDockerImageName(name);

        const tags = this._getVersionTags(version, dockerImage + ':');
        if (commitId) {
            tags.push(`${dockerImage}:${commitId}`);
        }

        return tags;
    }

    private _getVersionTags(version: string, prefix?: string): string[] {
        if (!prefix) {
            prefix = '';
        }

        const versionInfo = versionFormatter(version);

        return [
            `${prefix}${versionInfo.toFullVersion()}`,
            `${prefix}${versionInfo.toMinorVersion()}`,
            `${prefix}${versionInfo.toMajorVersion()}`,
        ];
    }

    private _getPrimaryDockerImage(name: string, version: string): string {
        const dockerImage = this._getDockerImageName(name);

        return `${dockerImage}:${version}`;
    }

    async tagDockerImage(name: string, tags: string[]): Promise<void> {
        this._progressListener.info('Tagging docker images', ...tags);

        await this._dockerService.tag(this._getLocalBuildName(name), tags);
    }

    async buildDockerImage(name: string, tags: string[]): Promise<string> {
        const dockerImageName = this._getLocalBuildName(name);
        await this._progressListener.progress(`Building local docker image: ${dockerImageName}`, async () => {
            return this._dockerService.build(this._directory, tags);
        });

        return dockerImageName;
    }

    private _getDockerImageName(name: string): string {
        if (this._hostInfo) {
            return `${this._hostInfo.host}/${name}`.toLowerCase();
        }
        return `${name}`.toLowerCase();
    }

    private _getLocalBuildName(name: string): string {
        return `${name}:local`.toLowerCase();
    }

    async pull(details: DockerDetails, target: string, registryService: RegistryService): Promise<void> {
        await this._progressListener.progress(`Pulling docker image: ${details.primary}`, async () => {
            await this._dockerService.pull(details.primary);
        });

        FSExtra.mkdirpSync(target);
        FS.writeFileSync(Path.join(target, 'docker-info.json'), JSON.stringify(details, null, 2));
    }

    async install(sourcePath: string, targetPath: string): Promise<void> {
        FSExtra.moveSync(sourcePath, targetPath, { overwrite: true });
    }

    async build(): Promise<void> {
        //Meant as a pre-test thing - Not applicable
    }

    async test(): Promise<void> {
        //Meant as a pre-deploy thing - Not applicable
    }
}
